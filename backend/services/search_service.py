"""
search_service.py — 书内关键词搜索 / 跨书全文检索

MVP 采用数据库 ILIKE 检索（SQLAlchemy 在 SQLite / PostgreSQL 下都能正确编译），
量级足以覆盖个人书库场景；后续如书库增长到数万章节，可平滑升级为 PostgreSQL
tsvector GIN 索引或 SQLite FTS5 虚表，无需改动上层 API。
"""

import re
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import Book, BookContentChunk, CitationBasketItem, CitationProject, Highlight, ReadingProgress
from serializers import _authors_list, cover_url_for

SNIPPET_RADIUS = 60


def _snippet(text: str, keyword: str) -> str:
    idx = text.lower().find(keyword.lower())
    if idx < 0:
        return text[: SNIPPET_RADIUS * 2]
    start = max(0, idx - SNIPPET_RADIUS)
    end = min(len(text), idx + len(keyword) + SNIPPET_RADIUS)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


def search_in_book(db: Session, book_id: str, keyword: str, limit: int = 100) -> list[dict]:
    if not keyword.strip():
        return []
    rows = (
        db.query(BookContentChunk)
        .filter(BookContentChunk.book_id == book_id, BookContentChunk.text.ilike(f"%{keyword}%"))
        .limit(limit)
        .all()
    )
    return [
        {
            "chapter_index": r.chapter_index,
            "chapter_title": r.chapter_title,
            "cfi_anchor": r.cfi_anchor,
            "snippet": _snippet(r.text, keyword),
        }
        for r in rows
    ]


def search_across_library(db: Session, keyword: str, limit: int = 50) -> list[dict]:
    """跨书全文检索：写作时想不起某句话出自哪本书时使用"""
    if not keyword.strip():
        return []
    rows = (
        db.query(BookContentChunk, Book)
        .join(Book, Book.id == BookContentChunk.book_id)
        .filter(BookContentChunk.text.ilike(f"%{keyword}%"))
        .limit(limit)
        .all()
    )
    results = []
    for chunk, book in rows:
        results.append(
            {
                "book_id": book.id,
                "book_title": book.title,
                "chapter_title": chunk.chapter_title,
                "cfi_anchor": chunk.cfi_anchor,
                "snippet": _snippet(chunk.text, keyword),
            }
        )
    return results


def search_global(db: Session, user_id: str, keyword: str, limit: int = 8) -> dict:
    """首页统一搜索：书籍 / 高亮笔记 / 引用篮（脚注）/ 正文原文 四类结果分组返回。

    "正文原文"直接复用 search_across_library 的全文检索结果，因此首页搜索已完整覆盖
    "全库检索"页面的能力——全库检索页仍保留，用于需要一次看到大量原文命中结果的场景，
    二者数据源一致，不存在功能冲突，只是结果呈现的详略程度不同。
    """
    keyword = keyword.strip()
    if not keyword:
        return {"books": [], "highlights": [], "citations": [], "fulltext": []}
    like = f"%{keyword}%"

    book_rows = (
        db.query(Book)
        .filter(or_(Book.title.ilike(like), Book.authors.ilike(like), Book.subtitle.ilike(like), Book.isbn.ilike(like)))
        .limit(limit)
        .all()
    )
    book_ids = [b.id for b in book_rows]
    status_map = {
        p.book_id: p.status
        for p in db.query(ReadingProgress).filter(
            ReadingProgress.user_id == user_id,
            ReadingProgress.book_id.in_(book_ids),
        )
    } if book_ids else {}
    books = [
        {
            "id": b.id,
            "title": b.title,
            "subtitle": b.subtitle,
            "authors": _authors_list(b),
            "cover_url": cover_url_for(b),
            "file_format": b.file_format,
            "reading_status": status_map.get(b.id, "unread"),
        }
        for b in book_rows
    ]

    hl_rows = (
        db.query(Highlight, Book)
        .join(Book, Book.id == Highlight.book_id)
        .filter(Highlight.user_id == user_id, or_(Highlight.quoted_text.ilike(like), Highlight.note.ilike(like)))
        .order_by(Highlight.created_at.desc())
        .limit(limit)
        .all()
    )
    highlights = [
        {
            "id": h.id,
            "book_id": h.book_id,
            "book_title": book.title,
            "cfi_range": h.cfi_range,
            "quoted_text": _snippet(h.quoted_text, keyword) if keyword.lower() in h.quoted_text.lower() else h.quoted_text[:120],
            "note": h.note,
            "chapter_title": h.chapter_title,
            "color": h.color,
        }
        for h, book in hl_rows
    ]

    cit_rows = (
        db.query(CitationBasketItem, CitationProject, Book)
        .join(CitationProject, CitationProject.id == CitationBasketItem.project_id)
        .join(Book, Book.id == CitationBasketItem.book_id)
        .filter(CitationProject.user_id == user_id, CitationBasketItem.quoted_text.ilike(like))
        .order_by(CitationBasketItem.created_at.desc())
        .limit(limit)
        .all()
    )
    citations = [
        {
            "id": item.id,
            "project_id": item.project_id,
            "project_name": project.name,
            "book_id": item.book_id,
            "book_title": book.title,
            "quoted_text": _snippet(item.quoted_text, keyword) if keyword.lower() in item.quoted_text.lower() else item.quoted_text[:120],
            "group_name": item.group_name,
            "page_no": item.page_no,
        }
        for item, project, book in cit_rows
    ]

    fulltext = search_across_library(db, keyword, limit=limit)

    return {"books": books, "highlights": highlights, "citations": citations, "fulltext": fulltext}
