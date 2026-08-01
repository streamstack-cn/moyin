"""api_books.py — 书籍上传、检索、详情、元数据编辑、文件与封面下发、阅读进度"""

import json
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

import storage
from database import get_db
from models import Book, BookTag, ReadingProgress, Tag, User, UserFavorite
from security import get_current_user, require_admin
from serializers import book_detail, book_summary
from services import metadata_service, progress_service, scan_service

router = APIRouter(prefix="/api/books", tags=["Books"])


def _tags_of(db: Session, book_id: str) -> list[Tag]:
    tag_ids = [r.tag_id for r in db.query(BookTag).filter_by(book_id=book_id)]
    if not tag_ids:
        return []
    return db.query(Tag).filter(Tag.id.in_(tag_ids)).all()


def _cleanup_orphan_tags(db: Session) -> None:
    """删除书籍或调整书籍标签后，清理掉不再关联任何书籍的标签，
    避免筛选栏里留下类似"旧约 (0)"这种僵尸标签"""
    used_tag_ids = [r[0] for r in db.query(BookTag.tag_id).distinct()]
    query = db.query(Tag)
    if used_tag_ids:
        query = query.filter(~Tag.id.in_(used_tag_ids))
    query.delete(synchronize_session=False)
    db.commit()


@router.post("/upload")
async def upload_book(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        stored_path = scan_service.copy_upload_to_storage(tmp_path, file.filename)
        book = await scan_service.ingest_file(db, stored_path, original_filename=file.filename)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return book_detail(book, _tags_of(db, book.id), is_favorite=False)


def _progress_map(db: Session, user_id: str) -> dict:
    return {p.book_id: p for p in db.query(ReadingProgress).filter(ReadingProgress.user_id == user_id)}


def _favorite_ids(db: Session, user_id: str) -> set[str]:
    rows = db.query(UserFavorite.book_id).filter(UserFavorite.user_id == user_id).all()
    return {r[0] for r in rows}


@router.get("")
def list_books(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    status: Optional[str] = None,
    library_id: Optional[str] = None,
    meta: Optional[str] = None,
    sort: str = "added_desc",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Book)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Book.title.ilike(like), Book.authors.ilike(like), Book.isbn.ilike(like)))
    if library_id:
        query = query.filter(Book.library_id == library_id)
    if meta == "missing_douban":
        # 尚未匹配豆瓣：无 douban_id
        query = query.filter(or_(Book.douban_id.is_(None), Book.douban_id == ""))
    fav_ids = _favorite_ids(db, user.id)
    if meta == "favorited":
        if not fav_ids:
            return []
        query = query.filter(Book.id.in_(fav_ids))
    if tag:
        tag_row = db.query(Tag).filter_by(name=tag).first()
        if tag_row:
            book_ids = [r.book_id for r in db.query(BookTag).filter_by(tag_id=tag_row.id)]
            query = query.filter(Book.id.in_(book_ids))

    if sort == "title":
        query = query.order_by(Book.title.asc())
    elif sort == "added_asc":
        query = query.order_by(Book.added_at.asc())
    else:
        query = query.order_by(Book.added_at.desc())

    books = query.all()
    progress_map = _progress_map(db, user.id)

    if status:
        books = [b for b in books if (progress_map.get(b.id).status if b.id in progress_map else "unread") == status]

    # 收藏筛选：按收藏时间倒序
    if meta == "favorited":
        order = {
            r.book_id: r.created_at
            for r in db.query(UserFavorite).filter(
                UserFavorite.user_id == user.id,
                UserFavorite.book_id.in_([b.id for b in books]),
            )
        }
        books.sort(key=lambda b: order.get(b.id) or b.added_at, reverse=True)

    return [
        book_summary(b, _tags_of(db, b.id), progress_map.get(b.id), is_favorite=b.id in fav_ids)
        for b in books
    ]


@router.get("/home")
def home_feed(
    limit: int = 12,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """首页数据：继续阅读（按最近阅读时间排序）+ 最新入库（按加入时间排序）"""
    progress_service.heal_finished_progress(db, user.id)
    progress_map = _progress_map(db, user.id)
    fav_ids = _favorite_ids(db, user.id)

    reading_rows = (
        db.query(ReadingProgress)
        .filter(
            ReadingProgress.user_id == user.id,
            ReadingProgress.status == "reading",
            ReadingProgress.percent < progress_service.FINISHED_THRESHOLD,
        )
        .order_by(ReadingProgress.updated_at.desc())
        .limit(limit)
        .all()
    )
    reading_book_ids = [r.book_id for r in reading_rows]
    books_by_id = {b.id: b for b in db.query(Book).filter(Book.id.in_(reading_book_ids)).all()} if reading_book_ids else {}
    continue_reading = [
        book_summary(
            books_by_id[bid],
            _tags_of(db, bid),
            progress_map.get(bid),
            is_favorite=bid in fav_ids,
        )
        for bid in reading_book_ids
        if bid in books_by_id
    ]

    recent_books = db.query(Book).order_by(Book.added_at.desc()).limit(limit).all()
    recent = [
        book_summary(b, _tags_of(db, b.id), progress_map.get(b.id), is_favorite=b.id in fav_ids)
        for b in recent_books
    ]

    return {"continue_reading": continue_reading, "recent": recent}


def _delete_book_physical(db: Session, book: Book) -> dict:
    """物理删除原文件 + 派生文件，成功后删除书目记录。失败且原文件仍在时抛 HTTPException。"""
    file_result = scan_service.delete_book_files(book)
    original_failed = [f for f in file_result["failed"] if f.get("kind") == "original"]
    if original_failed and book.file_path and Path(book.file_path).expanduser().exists():
        raise HTTPException(
            status_code=500,
            detail=f"无法删除《{book.title}》的本地文件：{original_failed[0].get('error') or book.file_path}",
        )
    db.delete(book)
    return file_result


class BatchDeletePayload(BaseModel):
    book_ids: list[str]


@router.post("/batch-delete")
def batch_delete_books(
    payload: BatchDeletePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """批量物理删除书籍（管理员）。用于「缺少信息」等列表的清理。"""
    ids = [i for i in (payload.book_ids or []) if i]
    if not ids:
        raise HTTPException(status_code=400, detail="未选择书籍")
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="单次最多删除 500 本")

    books = db.query(Book).filter(Book.id.in_(ids)).all()
    found = {b.id: b for b in books}
    deleted: list[str] = []
    failed: list[dict] = []

    for book_id in ids:
        book = found.get(book_id)
        if not book:
            failed.append({"id": book_id, "error": "书籍不存在"})
            continue
        title = book.title
        try:
            _delete_book_physical(db, book)
            deleted.append(book_id)
        except HTTPException as e:
            failed.append({"id": book_id, "title": title, "error": e.detail})
        except Exception as e:  # noqa: BLE001
            failed.append({"id": book_id, "title": title, "error": str(e)})

    db.commit()
    if deleted:
        _cleanup_orphan_tags(db)
    return {"success": True, "deleted": deleted, "failed": failed, "deleted_count": len(deleted)}


@router.get("/{book_id}")
def get_book(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    progress = db.query(ReadingProgress).filter_by(book_id=book_id, user_id=user.id).first()
    fav = db.query(UserFavorite).filter_by(book_id=book_id, user_id=user.id).first()
    return book_detail(book, _tags_of(db, book.id), progress, is_favorite=bool(fav))


class BookUpdatePayload(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    original_title: Optional[str] = None
    authors: Optional[list[str]] = None
    translator: Optional[str] = None
    publisher: Optional[str] = None
    pub_place: Optional[str] = None
    pub_date: Optional[str] = None
    isbn: Optional[str] = None
    series: Optional[str] = None
    page_count: Optional[int] = None
    language: Optional[str] = None
    description: Optional[str] = None
    catalog: Optional[str] = None
    producer: Optional[str] = None
    price: Optional[str] = None
    binding: Optional[str] = None
    tags: Optional[list[str]] = None


@router.patch("/{book_id}")
def update_book(
    book_id: str,
    payload: BookUpdatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")

    data = payload.model_dump(exclude_unset=True, exclude={"tags"})
    if "authors" in data and data["authors"] is not None:
        data["authors"] = json.dumps(data["authors"], ensure_ascii=False)
    for key, value in data.items():
        setattr(book, key, value)
    book.metadata_source = "manual"
    book.metadata_locked = True

    if payload.tags is not None:
        db.query(BookTag).filter_by(book_id=book.id).delete()
        for name in payload.tags:
            name = name.strip()
            if not name:
                continue
            tag = db.query(Tag).filter_by(name=name).first()
            if not tag:
                tag = Tag(name=name, source="manual")
                db.add(tag)
                db.flush()
            db.add(BookTag(book_id=book.id, tag_id=tag.id))

    db.commit()
    if payload.tags is not None:
        _cleanup_orphan_tags(db)
    db.refresh(book)
    fav = db.query(UserFavorite).filter_by(book_id=book.id, user_id=user.id).first()
    return book_detail(book, _tags_of(db, book.id), is_favorite=bool(fav))


@router.delete("/{book_id}")
def delete_book(book_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """删除书目记录，并物理删除本地原文件与封面/转换副本，避免重新扫描再次入库。"""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")

    file_result = _delete_book_physical(db, book)
    db.commit()
    _cleanup_orphan_tags(db)
    return {"success": True, "files": file_result}


@router.get("/{book_id}/cover")
def get_cover(book_id: str, db: Session = Depends(get_db)):
    book = db.query(Book).filter_by(id=book_id).first()
    cover = storage.resolve_stored_path(book.cover_path) if book else None
    if not book or not cover or not cover.is_file():
        raise HTTPException(status_code=404, detail="无封面")
    # URL 已带 ?v=mtime，可长缓存；无版本参数时也允许浏览器再验证
    return FileResponse(
        cover,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.post("/{book_id}/cover")
async def upload_cover(
    book_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_admin)
):
    """手动上传/更换封面：优先级高于自动匹配的在线封面与转码兜底封面"""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    dest = storage.COVERS_DIR / f"{uuid.uuid4().hex}{ext}"
    content = await file.read()
    dest.write_bytes(content)

    old_cover = book.cover_path
    book.cover_path = str(dest)
    db.commit()
    if old_cover and old_cover != str(dest) and Path(old_cover).exists():
        try:
            Path(old_cover).unlink()
        except OSError:
            pass
    from serializers import cover_url_for

    return {"cover_url": cover_url_for(book)}


@router.get("/{book_id}/file")
def download_file(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or not Path(book.file_path).exists():
        raise HTTPException(status_code=404, detail="原始文件不存在")
    filename = f"{book.title}.{book.file_format}"
    return FileResponse(book.file_path, filename=filename)


@router.get("/{book_id}/read")
def read_book(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    if book.file_format == "pdf":
        path = book.file_path
        if not path or not Path(path).exists():
            raise HTTPException(status_code=404, detail="PDF 文件不存在")
        return FileResponse(path, media_type="application/pdf", filename=f"{book.title}.pdf")
    path = book.file_path if book.file_format == "epub" else book.converted_path
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="该格式暂无法在线阅读，可下载原文件")
    return FileResponse(path, media_type="application/epub+zip")


# ── 阅读进度 ────────────────────────────────────────────────────────────
class ProgressPayload(BaseModel):
    location: Optional[str] = None
    percent: Optional[float] = None
    status: Optional[str] = None


@router.get("/{book_id}/progress")
def get_progress(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.query(ReadingProgress).filter_by(book_id=book_id, user_id=user.id).first()
    if not row:
        return {"location": "", "percent": 0.0, "status": "unread"}
    return {"location": row.location, "percent": row.percent, "status": row.status}


@router.put("/{book_id}/progress")
def set_progress(
    book_id: str,
    payload: ProgressPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = db.query(ReadingProgress).filter_by(book_id=book_id, user_id=user.id).first()
    if not row:
        row = ReadingProgress(book_id=book_id, user_id=user.id)
        db.add(row)
    if payload.location is not None:
        row.location = payload.location
    if payload.percent is not None:
        row.percent = progress_service.normalize_percent(payload.percent)
    if payload.status is not None:
        progress_service.sync_status_from_percent(row, explicit_status=payload.status)
    else:
        # 未显式传 status：按进度自动在读 / 已读完
        progress_service.sync_status_from_percent(row)
    db.commit()
    return {"success": True, "status": row.status, "percent": row.percent}


@router.post("/{book_id}/favorite")
def toggle_favorite(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """切换当前用户对该书的收藏状态"""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    row = db.query(UserFavorite).filter_by(book_id=book_id, user_id=user.id).first()
    if row:
        db.delete(row)
        db.commit()
        return {"success": True, "is_favorite": False}
    db.add(UserFavorite(user_id=user.id, book_id=book_id))
    db.commit()
    return {"success": True, "is_favorite": True}


# ── 元数据匹配 ──────────────────────────────────────────────────────────
@router.get("/{book_id}/metadata/search")
async def search_metadata(
    book_id: str,
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return await metadata_service.search_candidates(db, q)


class ApplyMetadataPayload(BaseModel):
    source: str
    source_id: str
    query_hint: str = ""


@router.post("/{book_id}/metadata/apply")
async def apply_metadata_route(
    book_id: str,
    payload: ApplyMetadataPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    meta = await metadata_service.fetch_full_metadata(db, payload.source, payload.source_id, payload.query_hint)
    if not meta:
        raise HTTPException(status_code=404, detail="未获取到详情")
    book.metadata_locked = False  # 允许被本次手动选择的结果覆盖
    apply_result = await scan_service.apply_metadata(book, meta, db=db)
    book.metadata_locked = True
    db.commit()
    db.refresh(book)
    fav = db.query(UserFavorite).filter_by(book_id=book.id, user_id=user.id).first()
    data = book_detail(book, _tags_of(db, book.id), is_favorite=bool(fav))
    data["cover_updated"] = bool(apply_result.get("cover_updated"))
    if apply_result.get("had_cover_url") and not apply_result.get("cover_updated"):
        data["cover_warning"] = "信息已更新，但封面下载失败，可点「更换封面」手动上传"
    return data
