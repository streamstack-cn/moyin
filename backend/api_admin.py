"""
api_admin.py — 管理员后台：用户管理、系统状态、阅读统计仪表盘、数据库备份导出

用户体系不开放注册，仅管理员可在此创建 / 禁用 / 删除其他账号。
"""

import os
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import storage
from database import DATABASE_URL, DATA_DIR, IS_SQLITE, get_db
from models import AppConfig, Book, CitationBasketItem, CitationProject, Highlight, ReadingProgress, User, UserFavorite
from security import get_current_user, hash_password, require_admin
from services import backup_service

router = APIRouter(prefix="/api/admin", tags=["Admin"])
settings_router = APIRouter(prefix="/api/settings", tags=["Settings"])

READER_WHEEL_KEY = "READER_WHEEL_PAGE_TURN"
LOGIN_COVER_FLOW_KEY = "LOGIN_COVER_FLOW"
GOOGLE_BOOKS_API_KEY = "GOOGLE_BOOKS_API_KEY"


def _get_config_bool(db: Session, key: str, default: bool = True) -> bool:
    row = db.query(AppConfig).filter_by(key=key).first()
    if not row or row.value == "":
        return default
    return row.value.lower() in ("1", "true", "yes", "on")


def _set_config(db: Session, key: str, value: str) -> None:
    row = db.query(AppConfig).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(AppConfig(key=key, value=value))


# ── 用户管理 ────────────────────────────────────────────────────────────
def _user_dict(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "role": u.role,
        "disabled": u.disabled,
        "created_at": u.created_at,
        "last_login_at": u.last_login_at,
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return [_user_dict(u) for u in db.query(User).order_by(User.created_at.asc()).all()]


class CreateUserPayload(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "reader"


@router.post("/users")
def create_user(payload: CreateUserPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.query(User).filter_by(username=payload.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name or payload.username,
        role=payload.role if payload.role in ("admin", "reader") else "reader",
        created_by=admin.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_dict(user)


class UpdateUserPayload(BaseModel):
    username: str | None = None
    display_name: str | None = None
    disabled: bool | None = None
    role: str | None = None
    password: str | None = None


@router.patch("/users/{user_id}")
def update_user(
    user_id: str, payload: UpdateUserPayload, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if payload.username is not None:
        new_name = payload.username.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="用户名不能为空")
        if len(new_name) < 2 or len(new_name) > 64:
            raise HTTPException(status_code=400, detail="用户名长度需在 2～64 之间")
        clash = db.query(User).filter(User.username == new_name, User.id != user.id).first()
        if clash:
            raise HTTPException(status_code=400, detail="用户名已存在")
        user.username = new_name
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.disabled is not None:
        if user.id == admin.id and payload.disabled:
            raise HTTPException(status_code=400, detail="不能禁用自己")
        user.disabled = payload.disabled
    if payload.role is not None and payload.role in ("admin", "reader"):
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="不能取消自己的管理员角色")
        user.role = payload.role
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(status_code=400, detail="密码至少 6 位")
        user.password_hash = hash_password(payload.password)
    db.commit()
    return _user_dict(user)


@router.delete("/users/{user_id}")
def delete_user(user_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.delete(user)
    db.commit()
    return {"success": True}


# ── 系统状态 ────────────────────────────────────────────────────────────
@router.get("/system")
def system_status(admin: User = Depends(require_admin)):
    from services import convert_service, docx_export_service, redis_client

    redis_url = os.environ.get("REDIS_URL", "")
    calibre_path = convert_service.calibre_bin_path()
    soffice_path = docx_export_service.soffice_bin_path()
    return {
        "database": "sqlite" if IS_SQLITE else "postgresql",
        "database_url_masked": DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL,
        "redis_configured": bool(redis_url),
        "redis_enabled": redis_client.ping_ok() if redis_url else False,
        "calibre_available": bool(calibre_path),
        "calibre_path": calibre_path or "",
        "libreoffice_available": bool(soffice_path),
        "libreoffice_path": soffice_path or "",
        "pdf_readable": True,
    }


@router.get("/changelog")
def admin_changelog(admin: User = Depends(require_admin)):
    """返回最近最多 10 条版本更新说明（新版本在前）。"""
    from changelog import list_changelog
    from version import APP_VERSION_LABEL, __version__

    entries = list_changelog(10)
    return {
        "current_version": __version__,
        "current_version_label": APP_VERSION_LABEL,
        "entries": entries,
        "max_entries": 10,
    }


@router.post("/repair-media")
def repair_media(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """补全缺失封面，并对可转换格式补做 Calibre -> EPUB；补建缺失的全文索引。"""
    from services import convert_service
    from services.scan_service import _index_content, _indexable_epub_path
    import storage

    books = db.query(Book).all()
    covers_fixed = 0
    converted = 0
    indexed = 0
    for book in books:
        if not book.cover_path or not Path(book.cover_path).exists():
            cover = convert_service.extract_cover_with_calibre(book.file_path, str(storage.COVERS_DIR))
            if cover:
                book.cover_path = cover
                covers_fixed += 1
        if convert_service.needs_conversion(book.file_format) and (
            not book.converted_path or not Path(book.converted_path).exists()
        ):
            dest = str(storage.CONVERTED_DIR / f"{book.file_hash}.epub")
            if convert_service.convert_to_epub(book.file_path, dest):
                book.converted_path = dest
                converted += 1
    db.commit()

    # 补索引：有可读 EPUB、但尚无章节块的书（含历史 mobi/azw3 转换书）
    from models import BookContentChunk

    for book in books:
        if not _indexable_epub_path(book):
            continue
        has_chunk = (
            db.query(BookContentChunk.id).filter(BookContentChunk.book_id == book.id).first()
        )
        if has_chunk:
            continue
        try:
            _index_content(db, book)
            indexed += 1
        except Exception:  # noqa: BLE001
            continue
    return {
        "success": True,
        "covers_fixed": covers_fixed,
        "converted": converted,
        "indexed": indexed,
    }


@router.get("/stats")
def reading_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """阅读统计仪表盘：本月读了几本、高亮数、引用篮沉淀量"""
    from services import progress_service

    progress_service.heal_finished_progress(db, user.id)
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total_books = db.query(Book).count()
    finished = db.query(ReadingProgress).filter_by(user_id=user.id, status="finished").count()
    reading = (
        db.query(ReadingProgress)
        .filter(
            ReadingProgress.user_id == user.id,
            ReadingProgress.status == "reading",
            ReadingProgress.percent >= progress_service.READING_MIN_PERCENT,
            ReadingProgress.percent < progress_service.FINISHED_THRESHOLD,
        )
        .count()
    )
    finished_this_month = (
        db.query(ReadingProgress)
        .filter(
            ReadingProgress.user_id == user.id,
            ReadingProgress.status == "finished",
            ReadingProgress.updated_at >= month_start,
        )
        .count()
    )
    total_highlights = db.query(Highlight).filter_by(user_id=user.id).count()
    total_citations = (
        db.query(CitationBasketItem)
        .join(CitationProject, CitationProject.id == CitationBasketItem.project_id)
        .filter(CitationProject.user_id == user.id)
        .count()
    )
    from sqlalchemy import or_

    missing_douban = (
        db.query(Book)
        .filter(or_(Book.douban_id.is_(None), Book.douban_id == ""))
        .count()
    )
    favorites = db.query(UserFavorite).filter_by(user_id=user.id).count()
    top_rated = db.query(Book).filter(Book.rating.isnot(None), Book.rating > 0).count()

    return {
        "total_books": total_books,
        "finished": finished,
        "reading": reading,
        "finished_this_month": finished_this_month,
        "total_highlights": total_highlights,
        "total_citations": total_citations,
        "missing_douban": missing_douban,
        "favorites": favorites,
        "top_rated": top_rated,
    }


# ── 阅读器全局设置 ──────────────────────────────────────────────────────
@settings_router.get("/reader")
def get_reader_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """所有登录用户可读：阅读页行为开关（如滚轮翻页）"""
    return {"wheel_page_turn": _get_config_bool(db, READER_WHEEL_KEY, True)}


class ReaderSettingsPayload(BaseModel):
    wheel_page_turn: bool


@settings_router.put("/reader")
def put_reader_settings(
    payload: ReaderSettingsPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    _set_config(db, READER_WHEEL_KEY, "true" if payload.wheel_page_turn else "false")
    db.commit()
    return {"success": True, "wheel_page_turn": payload.wheel_page_turn}


# ── 登录页全局设置（封面动态默认开；仅管理员可改） ─────────────────────
@settings_router.get("/login")
def get_login_settings(db: Session = Depends(get_db)):
    """公开接口：登录页需在未登录时读取封面动态开关，默认开启。"""
    return {"login_cover_flow": _get_config_bool(db, LOGIN_COVER_FLOW_KEY, True)}


class LoginSettingsPayload(BaseModel):
    login_cover_flow: bool


@settings_router.put("/login")
def put_login_settings(
    payload: LoginSettingsPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    _set_config(db, LOGIN_COVER_FLOW_KEY, "true" if payload.login_cover_flow else "false")
    db.commit()
    return {"success": True, "login_cover_flow": payload.login_cover_flow}


# ── Google Books API Key ────────────────────────────────────────────────
@settings_router.get("/google-books")
def get_google_books_settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    row = db.query(AppConfig).filter_by(key=GOOGLE_BOOKS_API_KEY).first()
    key = (row.value if row else "") or ""
    env_set = bool(os.environ.get("GOOGLE_BOOKS_API_KEY", "").strip())
    masked = ""
    if key:
        masked = key[:4] + "…" + key[-4:] if len(key) > 10 else "****"
    return {
        "api_key_set": bool(key) or env_set,
        "api_key_masked": masked,
        "from_env": env_set and not bool(key),
    }


class GoogleBooksSettingsPayload(BaseModel):
    api_key: str = ""


@settings_router.put("/google-books")
def put_google_books_settings(
    payload: GoogleBooksSettingsPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    key = (payload.api_key or "").strip()
    _set_config(db, GOOGLE_BOOKS_API_KEY, key)
    db.commit()
    return {"success": True, "api_key_set": bool(key) or bool(os.environ.get("GOOGLE_BOOKS_API_KEY", "").strip())}


@settings_router.post("/google-books/test")
async def test_google_books_settings(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """用当前配置的 API Key 做一次轻量连通性检测。"""
    from services import google_books_service

    row = db.query(AppConfig).filter_by(key=GOOGLE_BOOKS_API_KEY).first()
    key = (row.value if row else "") or ""
    return await google_books_service.ping(key)


# ── 书库自动 / 定时扫描 ────────────────────────────────────────────────
@settings_router.get("/library-scan")
def get_library_scan_settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    from services import library_jobs, library_watcher

    settings = library_jobs.load_schedule_settings(db)
    return {
        **settings,
        "watcher": library_watcher.watcher_status(),
        "scheduler": library_jobs.scheduler_status(),
    }


class LibraryScanSettingsPayload(BaseModel):
    schedule_enabled: bool
    interval_minutes: int = 60
    watch_debounce_sec: int = 8


@settings_router.put("/library-scan")
def put_library_scan_settings(
    payload: LibraryScanSettingsPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    from services import library_jobs, library_watcher

    minutes = max(5, min(24 * 60, int(payload.interval_minutes or 60)))
    debounce = max(2, min(120, int(payload.watch_debounce_sec or 8)))
    _set_config(db, library_jobs.SCHEDULE_ENABLED_KEY, "true" if payload.schedule_enabled else "false")
    _set_config(db, library_jobs.SCHEDULE_INTERVAL_KEY, str(minutes))
    _set_config(db, library_jobs.WATCH_DEBOUNCE_KEY, str(debounce))
    db.commit()

    library_jobs.restart_scheduler()
    library_watcher.refresh_watchers(debounce_sec=float(debounce))
    return {
        "success": True,
        "schedule_enabled": payload.schedule_enabled,
        "interval_minutes": minutes,
        "watch_debounce_sec": debounce,
        "watcher": library_watcher.watcher_status(),
        "scheduler": library_jobs.scheduler_status(),
    }


# ── 备份导出 / 恢复 ────────────────────────────────────────────────────
@router.get("/backup")
def export_backup_legacy(admin: User = Depends(require_admin)):
    """兼容旧链接：等同于全部数据备份。"""
    return export_full_backup(admin)


@router.get("/backup/config")
def export_config_backup(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """配置备份：所有用户账号/偏好、AI 配置、系统 AppConfig（不含书籍文件）。"""
    try:
        path = backup_service.build_config_backup(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"配置备份失败：{exc}") from exc
    return FileResponse(
        str(path),
        filename=path.name,
        media_type="application/zip",
    )


@router.get("/backup/full")
def export_full_backup(admin: User = Depends(require_admin)):
    """全部数据备份：数据库 + 封面/上传/转换文件等。"""
    try:
        path = backup_service.build_full_backup()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"全部数据备份失败：{exc}") from exc
    return FileResponse(
        str(path),
        filename=path.name,
        media_type="application/zip",
    )


@router.post("/backup/inspect")
async def inspect_backup(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
):
    """上传 zip 后识别是配置备份还是全部数据备份（不执行恢复）。"""
    suffix = Path(file.filename or "backup.zip").suffix or ".zip"
    with tempfile.NamedTemporaryFile(prefix="moyin_inspect_", suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        try:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
        finally:
            await file.close()
    try:
        return backup_service.inspect_backup_zip(tmp_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/backup/restore")
async def restore_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """恢复备份：自动识别配置备份 / 全部数据备份。全部数据恢复会覆盖当前库文件。"""
    suffix = Path(file.filename or "backup.zip").suffix or ".zip"
    with tempfile.NamedTemporaryFile(prefix="moyin_restore_", suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        try:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
        finally:
            await file.close()
    try:
        info = backup_service.inspect_backup_zip(tmp_path)
        if info["type"] == "config":
            result = backup_service.restore_config_backup(db, tmp_path)
        else:
            # 全部数据恢复会 dispose 连接池，先释放当前会话
            db.close()
            result = backup_service.restore_full_backup(tmp_path)
        return {
            "success": True,
            "detected_type": info.get("type"),
            "detected_label": info.get("type_label"),
            **result,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"恢复失败：{exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)
