"""serializers.py — ORM 对象转 JSON 友好字典的公共工具"""

import json
from pathlib import Path

from models import Book, Tag
from services.progress_service import status_from_percent


def _authors_list(book: Book) -> list[str]:
    if not book.authors:
        return []
    try:
        data = json.loads(book.authors)
        return data if isinstance(data, list) else [book.authors]
    except (json.JSONDecodeError, TypeError):
        return [book.authors]


def cover_url_for(book: Book) -> str:
    """封面地址带版本参数，避免匹配/更换封面后浏览器仍显示旧图。"""
    if not book.cover_path:
        return ""
    version = Path(book.cover_path).name[:16]
    try:
        p = Path(book.cover_path)
        if p.is_file():
            version = str(int(p.stat().st_mtime_ns))
    except OSError:
        pass
    return f"/api/books/{book.id}/cover?v={version}"


def book_summary(
    book: Book,
    tags: list[Tag] | None = None,
    progress=None,
    *,
    is_favorite: bool = False,
    library_name: str | None = None,
) -> dict:
    name = library_name
    if name is None:
        # relationship 已加载时直接取名，避免列表接口 N+1 时可显式传入
        lib = getattr(book, "library", None)
        name = lib.name if lib is not None else ""
    return {
        "id": book.id,
        "title": book.title,
        "subtitle": book.subtitle,
        "authors": _authors_list(book),
        "translator": book.translator,
        "publisher": book.publisher,
        "pub_date": book.pub_date,
        "cover_url": cover_url_for(book),
        "file_format": book.file_format,
        "rating": book.rating,
        "tags": [t.name for t in tags] if tags is not None else [],
        "readable": bool(
            book.file_format in ("epub", "txt", "pdf") or book.converted_path
        ),
        "added_at": book.added_at,
        "reading_status": (
            status_from_percent(progress.percent, stored_status=progress.status) if progress else "unread"
        ),
        "reading_percent": round(progress.percent * 100) if progress and progress.percent else 0,
        "last_read_at": progress.updated_at if progress else None,
        "library_id": book.library_id,
        "library_name": name or "",
        "douban_id": book.douban_id or "",
        "metadata_source": book.metadata_source or "",
        "is_favorite": bool(is_favorite),
    }


def book_detail(
    book: Book,
    tags: list[Tag] | None = None,
    progress=None,
    *,
    is_favorite: bool = False,
    library_name: str | None = None,
) -> dict:
    data = book_summary(
        book, tags, progress, is_favorite=is_favorite, library_name=library_name
    )
    data.update(
        {
            "original_title": book.original_title,
            "pub_place": book.pub_place,
            "isbn": book.isbn,
            "series": book.series,
            "page_count": book.page_count,
            "language": book.language,
            "description": book.description,
            "catalog": book.catalog or "",
            "producer": book.producer or "",
            "price": book.price or "",
            "binding": book.binding or "",
            "google_books_id": book.google_books_id,
            "metadata_locked": book.metadata_locked,
            "file_size": book.file_size,
        }
    )
    return data
