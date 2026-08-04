"""api_douban.py — 豆瓣登录态配置与探活（管理员专用）"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import AppConfig, User
from security import require_admin
from services import douban_service

router = APIRouter(prefix="/api/douban", tags=["Douban"])
logger = logging.getLogger("moyin.douban")

CONFIG_KEYS = [
    "DOUBAN_ENABLED",
    "DOUBAN_COOKIE",
    "DOUBAN_USER_ID",
    "DOUBAN_USER_NAME",
    "DOUBAN_PROBE_OK",
    "DOUBAN_PROBE_AT",
    "DOUBAN_PROBE_STATE",  # ok | risk | invalid | pending | none
    "DOUBAN_PROBE_MSG",
    "AUTO_MATCH_METADATA",
]

# 缓存可信窗口：此时间内打开管理页不打豆瓣，直接返回上次探活结果
CACHE_TRUST_SECONDS = 6 * 60 * 60
# 软保活：缓存仍可信但已超过该间隔时，后台异步探活刷新（不阻塞页面）
SOFT_KEEPALIVE_SECONDS = 30 * 60
# 风控态：每隔该间隔后台复检一次，看 IP 限制是否解除
RISK_RECHECK_SECONDS = 2 * 60
RISK_RECHECK_MAX_ATTEMPTS = 30  # 约 1 小时

_keepalive_lock = asyncio.Lock()
_keepalive_running = False
_risk_recheck_lock = asyncio.Lock()
_risk_recheck_running = False
_risk_recheck_cookie = ""
_risk_recheck_skip_delay = False


def _get_cfg(db: Session) -> dict:
    rows = db.query(AppConfig).filter(AppConfig.key.in_(CONFIG_KEYS)).all()
    return {r.key: r.value for r in rows}


def _set_config(db: Session, key: str, value: str) -> None:
    row = db.query(AppConfig).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(AppConfig(key=key, value=value))


def _set_many(db: Session, mapping: dict[str, str]) -> None:
    for key, value in mapping.items():
        _set_config(db, key, value)


def _probe_state_of(probe: dict[str, Any]) -> str:
    if probe.get("valid"):
        return "ok"
    if probe.get("risk_control"):
        return "risk"
    return "invalid"


def _persist_probe(db: Session, cookie: str, probe: dict[str, Any]) -> None:
    """写入探活结果。风控时保留 Cookie，不因 IP 限制清空登录态。"""
    now = str(int(time.time()))
    state = _probe_state_of(probe)
    msg = str(probe.get("error") or "")
    if state == "ok":
        _set_many(
            db,
            {
                "DOUBAN_COOKIE": cookie,
                "DOUBAN_USER_ID": probe.get("user_id") or "",
                "DOUBAN_USER_NAME": probe.get("name") or "",
                "DOUBAN_PROBE_OK": "true",
                "DOUBAN_PROBE_AT": now,
                "DOUBAN_PROBE_STATE": "ok",
                "DOUBAN_PROBE_MSG": "",
            },
        )
        return

    # risk：保留 Cookie 与已有昵称；invalid：Cookie 保留但清空失效的身份信息
    patch = {
        "DOUBAN_PROBE_OK": "false",
        "DOUBAN_PROBE_AT": now,
        "DOUBAN_PROBE_STATE": state,
        "DOUBAN_PROBE_MSG": msg,
    }
    if state == "invalid":
        patch["DOUBAN_USER_ID"] = ""
        patch["DOUBAN_USER_NAME"] = ""
    else:
        if probe.get("user_id"):
            patch["DOUBAN_USER_ID"] = str(probe.get("user_id") or "")
        if probe.get("name"):
            patch["DOUBAN_USER_NAME"] = str(probe.get("name") or "")
    _set_many(db, patch)


def _probe_age_seconds(cfg: dict) -> int | None:
    raw = (cfg.get("DOUBAN_PROBE_AT") or "").strip()
    if not raw.isdigit():
        return None
    return max(0, int(time.time()) - int(raw))


def _status_payload(
    *,
    enabled: bool,
    cookie_set: bool,
    cookie_ok: bool,
    state: str,
    message: str,
    user_id: str,
    user_name: str,
    source: str,
    checked_at: int | None,
    probe_age_seconds: int | None,
    auto_match_metadata: bool = True,
) -> dict[str, Any]:
    return {
        "enabled": enabled,
        "cookie_set": cookie_set,
        "cookie_ok": cookie_ok,
        "state": state,  # ok | risk | invalid | pending | none
        "message": message,
        "user_id": user_id,
        "user_name": user_name,
        "source": source,
        "checked_at": checked_at,
        "probe_age_seconds": probe_age_seconds,
        "auto_match_metadata": auto_match_metadata,
    }


async def _apply_probe_to_db(cookie: str, probe: dict[str, Any]) -> None:
    db = SessionLocal()
    try:
        _persist_probe(db, cookie, probe)
        db.commit()
    finally:
        db.close()


async def _background_keepalive(cookie: str) -> None:
    """后台软保活：不阻塞管理页加载，仅刷新探活缓存。"""
    global _keepalive_running
    async with _keepalive_lock:
        if _keepalive_running:
            return
        _keepalive_running = True
    try:
        probe = await douban_service.check_cookie(cookie)
        await _apply_probe_to_db(cookie, probe)
        logger.info(
            "豆瓣保活完成：valid=%s state=%s user=%s",
            probe.get("valid"),
            _probe_state_of(probe),
            probe.get("name") or probe.get("user_id"),
        )
    except Exception as e:
        logger.warning("豆瓣后台保活失败：%s", e)
    finally:
        async with _keepalive_lock:
            _keepalive_running = False


async def _background_risk_recheck() -> None:
    """风控解除前的定时复检：不删 Cookie；支持中途更换 Cookie 后继续跟新目标。"""
    global _risk_recheck_running, _risk_recheck_skip_delay
    async with _risk_recheck_lock:
        if _risk_recheck_running:
            return
        _risk_recheck_running = True
    try:
        first = True
        for attempt in range(1, RISK_RECHECK_MAX_ATTEMPTS + 1):
            if first:
                if not _risk_recheck_skip_delay:
                    await asyncio.sleep(RISK_RECHECK_SECONDS)
                _risk_recheck_skip_delay = False
                first = False
            else:
                await asyncio.sleep(RISK_RECHECK_SECONDS)

            cookie = (_risk_recheck_cookie or "").strip()
            if not cookie:
                return

            db = SessionLocal()
            try:
                cfg = _get_cfg(db)
            finally:
                db.close()
            current = (cfg.get("DOUBAN_COOKIE") or "").strip()
            if not current:
                logger.info("豆瓣风控复检停止：Cookie 已清空")
                return
            # 用户更新了 Cookie：跟新目标，不退出循环
            if current != cookie:
                cookie = current

            if cfg.get("DOUBAN_PROBE_STATE") == "ok":
                return

            probe = await douban_service.check_cookie(cookie)
            await _apply_probe_to_db(cookie, probe)
            state = _probe_state_of(probe)
            logger.info("豆瓣风控复检 #%s：state=%s", attempt, state)
            if state == "ok":
                return
            if state == "invalid":
                return
    except Exception as e:
        logger.warning("豆瓣风控复检失败：%s", e)
    finally:
        async with _risk_recheck_lock:
            _risk_recheck_running = False


def _schedule_risk_recheck(cookie: str, *, skip_delay: bool = False) -> None:
    global _risk_recheck_cookie, _risk_recheck_skip_delay
    if not cookie:
        return
    _risk_recheck_cookie = cookie
    if skip_delay:
        _risk_recheck_skip_delay = True
    try:
        asyncio.get_running_loop().create_task(_background_risk_recheck())
    except RuntimeError:
        pass


@router.get("/status")
async def status(
    probe: bool = Query(False, description="强制实时探活豆瓣登录态"),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    cfg = _get_cfg(db)
    enabled = cfg.get("DOUBAN_ENABLED", "false") == "true"
    auto_match = cfg.get("AUTO_MATCH_METADATA", "true") != "false"
    cookie = cfg.get("DOUBAN_COOKIE", "")
    if not cookie:
        return _status_payload(
            enabled=enabled,
            cookie_set=False,
            cookie_ok=False,
            state="none",
            message="",
            user_id="",
            user_name="",
            source="none",
            checked_at=None,
            probe_age_seconds=None,
            auto_match_metadata=auto_match,
        )

    age = _probe_age_seconds(cfg)
    cached_ok = cfg.get("DOUBAN_PROBE_OK", "") == "true"
    cached_state = (cfg.get("DOUBAN_PROBE_STATE") or ("ok" if cached_ok else "pending")).strip() or "pending"
    cached_msg = cfg.get("DOUBAN_PROBE_MSG") or ""
    cached_id = cfg.get("DOUBAN_USER_ID", "")
    cached_name = cfg.get("DOUBAN_USER_NAME", "")
    checked_at = int(cfg["DOUBAN_PROBE_AT"]) if (cfg.get("DOUBAN_PROBE_AT") or "").isdigit() else None

    # 风控/等待恢复：用缓存快速返回，并确保后台复检在跑
    if not probe and cached_state in ("risk", "pending") and age is not None and age < CACHE_TRUST_SECONDS:
        _schedule_risk_recheck(cookie, skip_delay=age >= RISK_RECHECK_SECONDS)
        return _status_payload(
            enabled=enabled,
            cookie_set=True,
            cookie_ok=False,
            state=cached_state,
            message=cached_msg
            or (
                "豆瓣对当前服务器 IP 触发了访问风控，Cookie 已保存，正在定时复检…"
                if cached_state == "risk"
                else "Cookie 已保存，正在检测登录态…"
            ),
            user_id=cached_id,
            user_name=cached_name,
            source="cache",
            checked_at=checked_at,
            probe_age_seconds=age,
            auto_match_metadata=auto_match,
        )

    # 明确无效：短时间走缓存，避免每次打开管理页都打豆瓣；仍可用「检测登录态」强制探活
    if not probe and cached_state == "invalid" and age is not None and age < SOFT_KEEPALIVE_SECONDS:
        return _status_payload(
            enabled=enabled,
            cookie_set=True,
            cookie_ok=False,
            state="invalid",
            message=cached_msg or "Cookie 无效或已过期，请重新登录后粘贴",
            user_id="",
            user_name="",
            source="cache",
            checked_at=checked_at,
            probe_age_seconds=age,
            auto_match_metadata=auto_match,
        )

    # 有可信可用缓存：直接返回，必要时触发后台软保活
    if (
        not probe
        and cached_ok
        and cached_state == "ok"
        and cached_id
        and age is not None
        and age < CACHE_TRUST_SECONDS
    ):
        if age >= SOFT_KEEPALIVE_SECONDS:
            asyncio.create_task(_background_keepalive(cookie))
        return _status_payload(
            enabled=enabled,
            cookie_set=True,
            cookie_ok=True,
            state="ok",
            message="",
            user_id=cached_id,
            user_name=cached_name,
            source="cache",
            checked_at=checked_at,
            probe_age_seconds=age,
            auto_match_metadata=auto_match,
        )

    # 强制探活，或缓存过期/缺失：同步打豆瓣
    live = await douban_service.check_cookie(cookie)
    _persist_probe(db, cookie, live)
    state = _probe_state_of(live)
    name = live.get("name") or cached_name or ""
    uid = live.get("user_id") or cached_id or ""
    if live.get("valid"):
        if (not name or name == live.get("user_id")) and cached_name and cached_name != live.get("user_id"):
            name = cached_name
            _set_config(db, "DOUBAN_USER_NAME", name)
        uid = live.get("user_id") or uid
    elif state == "invalid":
        uid, name = "", ""
    db.commit()

    if state in ("risk", "pending"):
        _schedule_risk_recheck(cookie)

    return _status_payload(
        enabled=enabled,
        cookie_set=True,
        cookie_ok=state == "ok",
        state=state,
        message=str(live.get("error") or ""),
        user_id=uid,
        user_name=name,
        source="live",
        checked_at=int(time.time()),
        probe_age_seconds=0,
        auto_match_metadata=auto_match,
    )


class SaveConfigPayload(BaseModel):
    DOUBAN_ENABLED: bool | None = None
    DOUBAN_COOKIE: str | None = None
    AUTO_MATCH_METADATA: bool | None = None


@router.post("/save_config")
def save_config(payload: SaveConfigPayload, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        str_value = "true" if value is True else ("false" if value is False else str(value))
        _set_config(db, key, str_value)
    db.commit()
    return {"success": True}


@router.post("/login_cookie")
async def login_cookie(
    payload: SaveConfigPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """粘贴 Cookie：格式通过即先落库；探活若遇风控不拒绝保存，改为后台定时复检。"""
    cookie = douban_service.prepare_cookie(payload.DOUBAN_COOKIE or "")
    if not cookie:
        raise HTTPException(status_code=400, detail="请粘贴豆瓣 Cookie")
    # 只做本地格式校验；缺登录凭证才拒绝（避免把风控当成「不能保存」）
    if not douban_service.cookie_has_login_token(cookie):
        raise HTTPException(
            status_code=400,
            detail="Cookie 中缺少 dbcl2（登录凭证）。请复制登录后的完整 Cookie。",
        )

    now = str(int(time.time()))
    # 先保存，再探活
    _set_many(
        db,
        {
            "DOUBAN_ENABLED": "true",
            "DOUBAN_COOKIE": cookie,
            "DOUBAN_PROBE_OK": "false",
            "DOUBAN_PROBE_AT": now,
            "DOUBAN_PROBE_STATE": "pending",
            "DOUBAN_PROBE_MSG": "Cookie 已保存，正在检测登录态…",
        },
    )
    db.commit()

    probe_result = await douban_service.check_cookie(cookie)
    _persist_probe(db, cookie, probe_result)
    db.commit()

    state = _probe_state_of(probe_result)
    if state in ("risk", "pending"):
        _schedule_risk_recheck(cookie)

    return {
        "success": True,
        "saved": True,
        "state": state,
        "cookie_ok": state == "ok",
        "user_id": probe_result.get("user_id") or "",
        "user_name": probe_result.get("name") or "",
        "message": probe_result.get("error")
        or (
            "登录成功"
            if state == "ok"
            else (
                "Cookie 已保存。当前服务器 IP 被豆瓣风控，将自动定时复检，恢复后指示灯变绿。"
                if state == "risk"
                else "Cookie 已保存，但未能确认登录态，请稍后点「检测登录态」。"
            )
        ),
    }


@router.post("/logout")
def logout_douban(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    _set_many(
        db,
        {
            "DOUBAN_COOKIE": "",
            "DOUBAN_USER_ID": "",
            "DOUBAN_USER_NAME": "",
            "DOUBAN_PROBE_OK": "false",
            "DOUBAN_PROBE_AT": "",
            "DOUBAN_PROBE_STATE": "none",
            "DOUBAN_PROBE_MSG": "",
            "DOUBAN_ENABLED": "false",
        },
    )
    db.commit()
    return {"success": True}


@router.get("/search")
async def search(q: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    cfg = _get_cfg(db)
    if cfg.get("DOUBAN_ENABLED", "false") != "true":
        raise HTTPException(status_code=400, detail="豆瓣功能未启用")
    results = await douban_service.search_books(q, cfg.get("DOUBAN_COOKIE", ""))
    return {"results": results}


# ── 扫码直接登录 ──────────────────────────────────────────────────────────
@router.post("/qrcode/start")
async def qrcode_start(user: User = Depends(require_admin)):
    """生成登录二维码，前端展示后引导管理员用手机豆瓣 App 扫码，无需手动复制 Cookie"""
    result = await douban_service.start_qrcode_login()
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "获取二维码失败"))
    return {"session_id": result["session_id"], "qrcode_url": result["qrcode_url"]}


@router.get("/qrcode/status")
async def qrcode_status(
    session_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)
):
    """轮询扫码状态；status 为 success 时后端已顺带把登录态 Cookie 落库并启用豆瓣功能"""
    result = await douban_service.poll_qrcode_login(session_id)
    if result.get("status") == "success":
        _set_many(
            db,
            {
                "DOUBAN_ENABLED": "true",
                "DOUBAN_COOKIE": result["cookie"],
                "DOUBAN_USER_ID": result["user_id"],
                "DOUBAN_USER_NAME": result.get("user_name") or result["user_id"],
                "DOUBAN_PROBE_OK": "true",
                "DOUBAN_PROBE_AT": str(int(time.time())),
                "DOUBAN_PROBE_STATE": "ok",
                "DOUBAN_PROBE_MSG": "",
            },
        )
        db.commit()
    return result
