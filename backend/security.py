"""
security.py — 密码哈希、JWT 签发与校验、当前用户依赖

用户体系不开放注册：仅管理员账号在首次启动时通过 ADMIN_USERNAME /
ADMIN_PASSWORD 环境变量创建，后续新增用户只能由管理员在后台创建。
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, Query, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import User

SECRET_KEY = os.environ.get("MOYIN_SECRET_KEY", "moyin-dev-secret-change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = int(os.environ.get("MOYIN_TOKEN_EXPIRE_HOURS", "24") or 24)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False


def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": user.id, "username": user.username, "role": user.role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    token_qs: Optional[str] = Query(default=None, alias="_t"),
    db: Session = Depends(get_db),
) -> User:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    elif token_qs:
        # 供 <a href>/<img src> 等无法自定义请求头的直链下载使用（封面、原文件、导出文档）
        token = token_qs
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或凭证已失效")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已过期，请重新登录")
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or user.disabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不存在或已被禁用")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可执行此操作")
    return user


def ensure_admin_seed(db: Session) -> None:
    """首次启动：若没有任何用户，则用 ADMIN_USERNAME / ADMIN_PASSWORD 创建管理员账号"""
    if db.query(User).count() > 0:
        return
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "moyin12345")
    admin = User(
        username=username,
        password_hash=hash_password(password),
        display_name="管理员",
        role="admin",
    )
    db.add(admin)
    db.commit()
