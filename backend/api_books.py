"""api_books.py — 书籍上传、检索、详情、元数据编辑、文件与封面下发、阅读进度"""

import json
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

import storage
from database import get_db
from models import (
    Book,
    BookTag,
    CitationBasketItem,
    CitationProject,
    Highlight,
    Library,
    ReadingProgress,
    Tag,
    User,
    UserFavorite,
)
from security import get_current_user, require_admin
from serializers import book_detail, book_summary, cover_url_for
from services import metadata_service, progress_service, scan_service

router = APIRouter(prefix="/api/books", tags=["Books"])


def _tags_of(db: Session, book_id: str) -> list[Tag]:
    tag_ids = [r.tag_id for r in db.query(BookTag).filter_by(book_id=book_id)]
    if not tag_ids:
        return []
    return db.query(Tag).filter(Tag.id.in_(tag_ids)).all()


def _library_name(db: Session, library_id: Optional[str]) -> str:
    if not library_id:
        return ""
    lib = db.query(Library).filter_by(id=library_id).first()
    return lib.name if lib else ""


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
    library_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """任意登录用户可上传电子书；入库后全站共享可见。

    元数据编辑 / 在线匹配 / 删书 / 换封面 / 转移书架等仍仅管理员。

    library_id 为空 / none / __none__：落入 uploads/（未归架）；
    否则写入对应书架目录并绑定 library_id。
    """
    target_library_id: Optional[str] = None
    library: Optional[Library] = None
    raw_lib = (library_id or "").strip()
    if raw_lib and raw_lib.lower() not in ("none", "__none__", "null"):
        library = db.query(Library).filter_by(id=raw_lib).first()
        if not library:
            raise HTTPException(status_code=404, detail="目标书架不存在")
        target_library_id = library.id

    suffix = Path(file.filename or "book.bin").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # 写入受监控的书架目录前抑制 watch，避免与上传入库并发产生重复书目
        if target_library_id:
            from services import library_watcher

            library_watcher.suppress_library_scans(target_library_id, seconds=120)
        stored_path = scan_service.place_uploaded_file(
            tmp_path,
            file.filename or f"book{suffix}",
            library_root=library.root_path if library else None,
        )
        book = await scan_service.ingest_file(
            db,
            stored_path,
            library_id=target_library_id,
            original_filename=file.filename,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except NotADirectoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"保存文件失败：{exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return book_detail(
        book,
        _tags_of(db, book.id),
        is_favorite=False,
        library_name=_library_name(db, book.library_id),
    )


class MoveLibraryPayload(BaseModel):
    """目标书架；null / 空字符串 / __none__ 表示转移到未归架。"""

    library_id: Optional[str] = None


@router.post("/{book_id}/move-library")
def move_book_library(
    book_id: str,
    payload: MoveLibraryPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """将书籍转移到目标书架目录，或收回未归架（uploads/）。"""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")

    raw = (payload.library_id or "").strip()
    library: Optional[Library] = None
    if raw and raw.lower() not in ("none", "__none__", "null"):
        library = db.query(Library).filter_by(id=raw).first()
        if not library:
            raise HTTPException(status_code=404, detail="目标书架不存在")

    # 已在目标归属时仍走 transfer（目录内只改归属 / 幂等）
    target_id = library.id if library else None
    if target_id == book.library_id and library is None:
        return {
            "success": True,
            "moved": False,
            "book": book_detail(
                book,
                _tags_of(db, book.id),
                library_name="",
            ),
        }

    try:
        if library is not None:
            from services import library_watcher

            library_watcher.suppress_library_scans(library.id, seconds=120)
        if book.library_id and (library is None or book.library_id != library.id):
            from services import library_watcher

            library_watcher.suppress_library_scans(book.library_id, seconds=120)
        result = scan_service.transfer_book_file(book, library=library)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"转移文件失败：{exc}") from exc

    db.commit()
    db.refresh(book)
    return {
        "success": True,
        "moved": result.get("moved", True),
        "book": book_detail(
            book,
            _tags_of(db, book.id),
            library_name=_library_name(db, book.library_id),
        ),
    }


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
    if meta == "top_rated":
        # 高分推荐：只看有豆瓣评分的书
        query = query.filter(Book.rating.isnot(None), Book.rating > 0)
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
    elif sort == "rating_desc" or meta == "top_rated":
        query = query.order_by(Book.rating.desc(), Book.added_at.desc())
    else:
        query = query.order_by(Book.added_at.desc())

    books = query.all()
    progress_service.heal_finished_progress(db, user.id)
    progress_map = _progress_map(db, user.id)

    if status:
        books = [
            b
            for b in books
            if (
                progress_service.status_from_percent(
                    progress_map[b.id].percent,
                    stored_status=progress_map[b.id].status,
                )
                if b.id in progress_map
                else "unread"
            )
            == status
        ]

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
    """首页数据：继续阅读 + 最新入库 + 引用篮条目（与引用篮同源）"""
    progress_service.heal_finished_progress(db, user.id)
    progress_map = _progress_map(db, user.id)
    fav_ids = _favorite_ids(db, user.id)

    reading_rows = (
        db.query(ReadingProgress)
        .filter(
            ReadingProgress.user_id == user.id,
            ReadingProgress.status == "reading",
            ReadingProgress.percent >= progress_service.READING_MIN_PERCENT,
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

    # 摘录与引用：引用篮 + 高亮，卡片用 kind 区分；已入引用篮的高亮不重复展示
    cite_rows = (
        db.query(CitationBasketItem, CitationProject.name)
        .join(CitationProject, CitationProject.id == CitationBasketItem.project_id)
        .filter(
            CitationProject.user_id == user.id,
            CitationBasketItem.quoted_text != "",
            CitationBasketItem.quoted_text.isnot(None),
        )
        .order_by(CitationBasketItem.created_at.desc())
        .limit(16)
        .all()
    )
    linked_hl_ids = {item.highlight_id for item, _name in cite_rows if item.highlight_id}

    hl_rows = (
        db.query(Highlight)
        .filter(
            Highlight.user_id == user.id,
            Highlight.quoted_text != "",
            Highlight.quoted_text.isnot(None),
        )
        .order_by(Highlight.updated_at.desc())
        .limit(16)
        .all()
    )

    book_ids = list({item.book_id for item, _name in cite_rows} | {h.book_id for h in hl_rows})
    books_map = (
        {b.id: b for b in db.query(Book).filter(Book.id.in_(book_ids)).all()} if book_ids else {}
    )
    cite_hl_ids = [item.highlight_id for item, _name in cite_rows if item.highlight_id]
    cite_hls = (
        {h.id: h for h in db.query(Highlight).filter(Highlight.id.in_(cite_hl_ids)).all()}
        if cite_hl_ids
        else {}
    )

    snippets: list[dict] = []
    for item, project_name in cite_rows:
        book = books_map.get(item.book_id)
        text = (item.quoted_text or "").strip()
        if not text:
            continue
        hl = cite_hls.get(item.highlight_id) if item.highlight_id else None
        cfi = (item.cfi_range or "").strip() or ((hl.cfi_range if hl else "") or "")
        snippets.append(
            {
                "kind": "citation",
                "id": item.id,
                "project_id": item.project_id,
                "project_name": (project_name or "").strip(),
                "book_id": item.book_id,
                "book_title": (book.title if book else "") or "",
                "file_format": (book.file_format if book else "") or "",
                "cover_url": cover_url_for(book) if book else "",
                "quoted_text": text,
                "page_no": item.page_no or "",
                "group_name": item.group_name or "",
                "note": "",
                "chapter_title": (hl.chapter_title if hl else "") or "",
                "color": (hl.color if hl else "") or "",
                "cfi_range": cfi,
                "highlight_id": item.highlight_id or "",
                "created_at": item.created_at.isoformat() if item.created_at else "",
            }
        )

    for h in hl_rows:
        if h.id in linked_hl_ids:
            continue
        book = books_map.get(h.book_id)
        text = (h.quoted_text or "").strip()
        if not text or not book:
            continue
        snippets.append(
            {
                "kind": "highlight",
                "id": h.id,
                "project_id": "",
                "project_name": "",
                "book_id": h.book_id,
                "book_title": book.title or "",
                "file_format": book.file_format or "",
                "cover_url": cover_url_for(book),
                "quoted_text": text,
                "page_no": h.page_no or "",
                "group_name": "",
                "note": h.note or "",
                "chapter_title": h.chapter_title or "",
                "color": h.color or "#ffd54f",
                "cfi_range": h.cfi_range or "",
                "highlight_id": h.id,
                "created_at": h.updated_at.isoformat() if h.updated_at else "",
            }
        )

    snippets.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    snippets = snippets[:16]

    return {
        "continue_reading": continue_reading,
        "recent": recent,
        "recent_snippets": snippets,
    }


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
    # 再扫一遍 converted/，清掉已无书目引用的孤儿转换文件
    try:
        file_result["orphan_converted_removed"] = scan_service.purge_orphan_converted_files(db)
    except Exception:  # noqa: BLE001
        file_result["orphan_converted_removed"] = 0
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


async def _rematch_one_book(db: Session, book: Book) -> dict:
    """对单本书执行自动匹配；返回 matched / error，不抛业务失败。"""
    from services import douban_service

    title = book.title or ""
    try:
        book.metadata_locked = False
        meta = await metadata_service.auto_match(
            db,
            book.title or "",
            book.isbn or "",
            year=(book.pub_date or "")[:4],
            publisher=book.publisher or "",
            original_title=book.original_title or "",
        )
        if not meta:
            db.commit()
            return {"matched": False, "id": book.id, "title": title, "error": "未找到合适匹配"}
        meta = {k: v for k, v in meta.items() if not str(k).startswith("_")}
        await scan_service.apply_metadata(book, meta, db=db)
        db.commit()
        return {"matched": True, "id": book.id, "title": title}
    except douban_service.DoubanRiskControlError as e:
        db.rollback()
        return {
            "matched": False,
            "id": book.id,
            "title": title,
            "error": str(e) or "豆瓣触发风控，请更新 Cookie",
            "risk_control": True,
        }
    except Exception as e:  # noqa: BLE001
        db.rollback()
        return {"matched": False, "id": book.id, "title": title, "error": str(e)}


@router.post("/batch-rematch")
async def batch_rematch_books(
    payload: BatchDeletePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """批量重新匹配在线元数据（管理员）。用于「缺少信息」列表补全。"""
    ids = [i for i in (payload.book_ids or []) if i]
    if not ids:
        raise HTTPException(status_code=400, detail="未选择书籍")
    if len(ids) > 200:
        raise HTTPException(status_code=400, detail="单次最多重新匹配 200 本")

    books = db.query(Book).filter(Book.id.in_(ids)).all()
    found = {b.id: b for b in books}
    matched: list[str] = []
    failed: list[dict] = []

    for book_id in ids:
        book = found.get(book_id)
        if not book:
            failed.append({"id": book_id, "error": "书籍不存在"})
            continue
        result = await _rematch_one_book(db, book)
        if result.get("matched"):
            matched.append(book_id)
        else:
            failed.append(
                {
                    "id": book_id,
                    "title": result.get("title"),
                    "error": result.get("error") or "匹配失败",
                }
            )

    if matched:
        _cleanup_orphan_tags(db)

    return {
        "success": True,
        "matched": matched,
        "failed": failed,
        "matched_count": len(matched),
        "failed_count": len(failed),
    }


@router.post("/{book_id}/rematch")
async def rematch_book(
    book_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """单本重新匹配在线元数据（管理员）。供前端进度弹窗逐本调用。"""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    result = await _rematch_one_book(db, book)
    return {"success": True, **result}


@router.get("/{book_id}")
def get_book(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    progress = db.query(ReadingProgress).filter_by(book_id=book_id, user_id=user.id).first()
    fav = db.query(UserFavorite).filter_by(book_id=book_id, user_id=user.id).first()
    return book_detail(
        book,
        _tags_of(db, book.id),
        progress,
        is_favorite=bool(fav),
        library_name=_library_name(db, book.library_id),
    )


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


def _resolve_and_heal_book_path(book: Book, db: Session) -> Optional[str]:
    """优先用库内路径；失效则按当前挂载根重绑并写回数据库。"""
    from services.fs_browse import resolve_book_file_path

    resolved = resolve_book_file_path(book.file_path)
    if resolved and resolved != (book.file_path or ""):
        book.file_path = resolved
        db.commit()
    return resolved


@router.get("/{book_id}/file")
def download_file(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    book = db.query(Book).filter_by(id=book_id).first()
    path = _resolve_and_heal_book_path(book, db) if book else None
    if not book or not path:
        raise HTTPException(status_code=404, detail="原始文件不存在")
    filename = f"{book.title}.{book.file_format}"
    return FileResponse(path, filename=filename)


@router.get("/{book_id}/read")
def read_book(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    if book.file_format == "pdf":
        path = _resolve_and_heal_book_path(book, db)
        if not path:
            raise HTTPException(status_code=404, detail="PDF 文件不存在")
        return FileResponse(path, media_type="application/pdf", filename=f"{book.title}.pdf")
    if book.file_format == "epub":
        path = _resolve_and_heal_book_path(book, db)
    else:
        path = book.converted_path if book.converted_path and Path(book.converted_path).exists() else None
        if not path:
            # 部分转换失败场景仍可能直接读到原 epub 路径
            path = _resolve_and_heal_book_path(book, db)
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
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    return await metadata_service.search_candidates(
        db,
        q,
        year=(book.pub_date or "")[:4],
        publisher=book.publisher or "",
        original_title=book.original_title or "",
        isbn=book.isbn or "",
    )


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
