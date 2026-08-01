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
    "AUTO_MATCH_METADATA",
]

# 缓存可信窗口：此时间内打开管理页不打豆瓣，直接返回上次探活结果
CACHE_TRUST_SECONDS = 6 * 60 * 60
# 软保活：缓存仍可信但已超过该间隔时，后台异步探活刷新（不阻塞页面）
SOFT_KEEPALIVE_SECONDS = 30 * 60

_keepalive_lock = asyncio.Lock()
_keepalive_running = False


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


def _persist_probe(db: Session, cookie: str, probe: dict[str, Any]) -> None:
    now = str(int(time.time()))
    if probe.get("valid"):
        _set_many(
            db,
            {
                "DOUBAN_COOKIE": cookie,
                "DOUBAN_USER_ID": probe.get("user_id") or "",
                "DOUBAN_USER_NAME": probe.get("name") or "",
                "DOUBAN_PROBE_OK": "true",
                "DOUBAN_PROBE_AT": now,
            },
        )
    else:
        _set_many(
            db,
            {
                "DOUBAN_PROBE_OK": "false",
                "DOUBAN_PROBE_AT": now,
            },
        )


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
    user_id: str,
    user_name: str,
    source: str,
    checked_at: int | None,
    probe_age_seconds: int | None,
) -> dict[str, Any]:
    return {
        "enabled": enabled,
        "cookie_set": cookie_set,
        "cookie_ok": cookie_ok,
        "user_id": user_id,
        "user_name": user_name,
        "source": source,
        "checked_at": checked_at,
        "probe_age_seconds": probe_age_seconds,
    }


async def _background_keepalive(cookie: str) -> None:
    """后台软保活：不阻塞管理页加载，仅刷新探活缓存。"""
    global _keepalive_running
    async with _keepalive_lock:
        if _keepalive_running:
            return
        _keepalive_running = True
    try:
        probe = await douban_service.check_cookie(cookie)
        db = SessionLocal()
        try:
            _persist_probe(db, cookie, probe)
            db.commit()
        finally:
            db.close()
        logger.info(
            "豆瓣保活完成：valid=%s user=%s",
            probe.get("valid"),
            probe.get("name") or probe.get("user_id"),
        )
    except Exception as e:
        logger.warning("豆瓣后台保活失败：%s", e)
    finally:
        async with _keepalive_lock:
            _keepalive_running = False


@router.get("/status")
async def status(
    probe: bool = Query(False, description="强制实时探活豆瓣登录态"),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    cfg = _get_cfg(db)
    enabled = cfg.get("DOUBAN_ENABLED", "false") == "true"
    cookie = cfg.get("DOUBAN_COOKIE", "")
    if not enabled or not cookie:
        return _status_payload(
            enabled=enabled,
            cookie_set=bool(cookie),
            cookie_ok=False,
            user_id="",
            user_name="",
            source="none",
            checked_at=None,
            probe_age_seconds=None,
        )

    age = _probe_age_seconds(cfg)
    cached_ok = cfg.get("DOUBAN_PROBE_OK", "") == "true"
    cached_id = cfg.get("DOUBAN_USER_ID", "")
    cached_name = cfg.get("DOUBAN_USER_NAME", "")
    checked_at = int(cfg["DOUBAN_PROBE_AT"]) if (cfg.get("DOUBAN_PROBE_AT") or "").isdigit() else None

    # 有可信缓存：直接返回，必要时触发后台软保活
    if (
        not probe
        and cached_ok
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
            user_id=cached_id,
            user_name=cached_name,
            source="cache",
            checked_at=checked_at,
            probe_age_seconds=age,
        )

    # 强制探活，或缓存过期/缺失：同步打豆瓣
    live = await douban_service.check_cookie(cookie)
    _persist_probe(db, cookie, live)
    # 若仍有旧昵称且本次解析失败回落到 id，尽量保留已写入的正确昵称
    if live.get("valid"):
        name = live.get("name") or ""
        if (not name or name == live.get("user_id")) and cached_name and cached_name != live.get("user_id"):
            name = cached_name
            _set_config(db, "DOUBAN_USER_NAME", name)
        db.commit()
        return _status_payload(
            enabled=enabled,
            cookie_set=True,
            cookie_ok=True,
            user_id=live.get("user_id") or "",
            user_name=name,
            source="live",
            checked_at=int(time.time()),
            probe_age_seconds=0,
        )

    db.commit()
    return _status_payload(
        enabled=enabled,
        cookie_set=True,
        cookie_ok=False,
        user_id="",
        user_name="",
        source="live",
        checked_at=int(time.time()),
        probe_age_seconds=0,
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
    """浏览器登录页登录后：粘贴 Cookie，校验并写入登录态（对齐 Obsidian Douban 的 Login 结果展示）。"""
    cookie = (payload.DOUBAN_COOKIE or "").strip()
    if not cookie:
        raise HTTPException(status_code=400, detail="请粘贴豆瓣 Cookie")
    probe_result = await douban_service.check_cookie(cookie)
    if not probe_result["valid"]:
        raise HTTPException(status_code=400, detail="Cookie 无效或已过期，请重新在豆瓣登录页登录后再复制")
    _set_many(
        db,
        {
            "DOUBAN_ENABLED": "true",
            "DOUBAN_COOKIE": cookie,
            "DOUBAN_USER_ID": probe_result["user_id"],
            "DOUBAN_USER_NAME": probe_result["name"] or probe_result["user_id"],
            "DOUBAN_PROBE_OK": "true",
            "DOUBAN_PROBE_AT": str(int(time.time())),
        },
    )
    db.commit()
    return {"success": True, "user_id": probe_result["user_id"], "user_name": probe_result["name"]}


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
            },
        )
        db.commit()
    return result
