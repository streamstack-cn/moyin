"""api_highlights.py — 高亮 / 笔记 CRUD 与本书笔记目录"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Highlight, User
from security import get_current_user

router = APIRouter(prefix="/api/highlights", tags=["Highlights"])


def _serialize(h: Highlight) -> dict:
    return {
        "id": h.id,
        "book_id": h.book_id,
        "cfi_range": h.cfi_range,
        "color": h.color,
        "quoted_text": h.quoted_text,
        "note": h.note,
        "chapter_title": h.chapter_title,
        "page_no": h.page_no,
        "created_at": h.created_at,
        "updated_at": h.updated_at,
    }


@router.get("/book/{book_id}")
def list_highlights(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(Highlight)
        .filter(Highlight.book_id == book_id, Highlight.user_id == user.id)
        .order_by(Highlight.created_at.asc())
        .all()
    )
    return [_serialize(h) for h in rows]


class HighlightPayload(BaseModel):
    book_id: str
    # EPUB: epubcfi(...)；PDF: pdf:#page=N&selection=i0,o0,i1,o1（软高亮，不改 PDF 文件）
    cfi_range: str
    color: str = "#ffd54f"
    quoted_text: str = ""
    note: str = ""
    chapter_title: str = ""
    page_no: str = ""


@router.post("")
def create_highlight(payload: HighlightPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    locator = (payload.cfi_range or "").strip()
    if not locator:
        raise HTTPException(status_code=400, detail="缺少定位信息")
    if len(locator) > 512:
        raise HTTPException(status_code=400, detail="定位信息过长")
    # 允许 EPUB CFI 与 PDF 软定位；拒绝明显非法空串已在上方处理
    data = payload.model_dump()
    data["cfi_range"] = locator
    h = Highlight(user_id=user.id, **data)
    db.add(h)
    db.commit()
    db.refresh(h)
    return _serialize(h)


class HighlightUpdatePayload(BaseModel):
    color: Optional[str] = None
    note: Optional[str] = None


@router.patch("/{highlight_id}")
def update_highlight(
    highlight_id: str,
    payload: HighlightUpdatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    h = db.query(Highlight).filter_by(id=highlight_id, user_id=user.id).first()
    if not h:
        raise HTTPException(status_code=404, detail="高亮不存在")
    if payload.color is not None:
        h.color = payload.color
    if payload.note is not None:
        h.note = payload.note
    db.commit()
    return _serialize(h)


@router.delete("/{highlight_id}")
def delete_highlight(
    highlight_id: str,
    also_citations: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """删除高亮；默认同步移除引用篮中关联该高亮的条目。"""
    from models import CitationBasketItem, CitationProject

    h = db.query(Highlight).filter_by(id=highlight_id, user_id=user.id).first()
    if not h:
        raise HTTPException(status_code=404, detail="高亮不存在")
    removed_citations = 0
    if also_citations:
        project_ids = [
            p.id for p in db.query(CitationProject).filter_by(user_id=user.id).all()
        ]
        if project_ids:
            removed_citations = (
                db.query(CitationBasketItem)
                .filter(
                    CitationBasketItem.highlight_id == highlight_id,
                    CitationBasketItem.project_id.in_(project_ids),
                )
                .delete(synchronize_session=False)
            )
    db.delete(h)
    db.commit()
    return {"success": True, "removed_citations": removed_citations}
