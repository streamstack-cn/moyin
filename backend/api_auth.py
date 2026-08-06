"""api_auth.py — 登录 / 当前用户信息 / 账号级个人偏好设置"""

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Book, User
from security import create_access_token, get_current_user, hash_password, verify_password
import storage
from serializers import cover_url_for
from services import redis_client

router = APIRouter(prefix="/api/auth", tags=["Auth"])

_LOGIN_MAX_ATTEMPTS = 8
_LOGIN_WINDOW_SECONDS = 300  # 5 分钟内失败超限则临时锁定，避免暴力破解密码


def _login_rate_key(username: str, client_ip: str) -> str:
    return f"moyin:login_fail:{username}:{client_ip}"


def _check_login_lock(username: str, client_ip: str) -> None:
    """Redis 未配置时直接跳过限流（不影响单容器无 Redis 场景下的正常登录）"""
    client = redis_client.get_redis()
    if not client:
        return
    try:
        attempts = client.get(_login_rate_key(username, client_ip))
    except Exception:  # noqa: BLE001
        return
    if attempts and int(attempts) >= _LOGIN_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail=f"登录失败次数过多，请 {_LOGIN_WINDOW_SECONDS // 60} 分钟后再试")


def _record_login_failure(username: str, client_ip: str) -> None:
    client = redis_client.get_redis()
    if not client:
        return
    key = _login_rate_key(username, client_ip)
    try:
        pipe = client.pipeline()
        pipe.incr(key)
        pipe.expire(key, _LOGIN_WINDOW_SECONDS)
        pipe.execute()
    except Exception:  # noqa: BLE001
        pass


def _clear_login_failures(username: str, client_ip: str) -> None:
    client = redis_client.get_redis()
    if not client:
        return
    try:
        client.delete(_login_rate_key(username, client_ip))
    except Exception:  # noqa: BLE001
        pass


def _load_preferences(user: User) -> dict:
    try:
        data = json.loads(user.preferences or "{}")
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


class LoginPayload(BaseModel):
    username: str
    password: str
    remember_me: bool = True


@router.post("/login")
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_login_lock(payload.username, client_ip)

    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        _record_login_failure(payload.username, client_ip)
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.disabled:
        raise HTTPException(status_code=403, detail="账号已被管理员禁用")

    _clear_login_failures(payload.username, client_ip)
    user.last_login_at = datetime.utcnow()
    db.commit()
    remember = bool(payload.remember_me)
    token = create_access_token(user, remember_me=remember)
    return {
        "token": token,
        "remember_me": remember,
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
            "preferences": _load_preferences(user),
        },
    }


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "preferences": _load_preferences(user),
    }


@router.get("/login-covers")
def login_covers(db: Session = Depends(get_db), limit: int = 60):
    """登录页封面墙：无需登录。优先高分有封面书籍，供动态背景使用。"""
    take = max(12, min(int(limit or 60), 96))
    rows = (
        db.query(Book)
        .filter(Book.cover_path.isnot(None), Book.cover_path != "")
        .order_by(Book.rating.desc(), Book.updated_at.desc())
        .limit(take * 2)
        .all()
    )
    covers: list[str] = []
    for book in rows:
        path = storage.resolve_stored_path(book.cover_path)
        if not path or not path.is_file():
            continue
        url = cover_url_for(book)
        if url:
            covers.append(url)
        if len(covers) >= take:
            break
    return {"covers": covers}


@router.get("/me/preferences")
def get_preferences(user: User = Depends(get_current_user)):
    return _load_preferences(user)


@router.patch("/me/preferences")
def update_preferences(payload: dict[str, Any], db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """局部更新：只需传入本次修改的键，未传入的键保持不变"""
    current = _load_preferences(user)
    current.update(payload or {})
    user.preferences = json.dumps(current, ensure_ascii=False)
    db.commit()
    return current


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/password")
def change_password(
    payload: ChangePasswordPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """当前登录用户修改自己的密码（管理员与普通读者均可）。"""
    if not verify_password(payload.current_password or "", user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    new_pw = (payload.new_password or "").strip()
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    if verify_password(new_pw, user.password_hash):
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
    user.password_hash = hash_password(new_pw)
    db.commit()
    return {"success": True}
