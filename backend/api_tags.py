"""api_tags.py — 标签与书架（合集）管理"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import BookTag, Collection, CollectionBook, Tag, User
from security import get_current_user, require_admin
from serializers import book_summary
from models import Book

router = APIRouter(prefix="/api/tags", tags=["Tags"])
collections_router = APIRouter(prefix="/api/collections", tags=["Collections"])


def _get_owned_collection(db: Session, collection_id: str, user: User) -> Collection:
    """书架/合集为用户私有数据，需先校验归属，避免跨用户读取或篡改他人书架"""
    c = db.query(Collection).filter_by(id=collection_id, user_id=user.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="书架不存在")
    return c


@router.get("")
def list_tags(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tags = db.query(Tag).order_by(Tag.name.asc()).all()
    counts = {}
    for row in db.query(BookTag).all():
        counts[row.tag_id] = counts.get(row.tag_id, 0) + 1
    return [{"id": t.id, "name": t.name, "source": t.source, "book_count": counts.get(t.id, 0)} for t in tags]


@router.delete("/{tag_id}")
def delete_tag(tag_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """标签为全库共享的分类体系，删除会影响所有用户看到的书籍分类，仅管理员可操作"""
    tag = db.query(Tag).filter_by(id=tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    db.delete(tag)
    db.commit()
    return {"success": True}


# ── 书架 / 合集 ────────────────────────────────────────────────────────
class CollectionPayload(BaseModel):
    name: str
    is_smart: bool = False
    smart_query: str = ""


@collections_router.get("")
def list_collections(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Collection).filter_by(user_id=user.id).order_by(Collection.created_at.desc()).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "is_smart": c.is_smart,
            "smart_query": c.smart_query,
            "book_count": db.query(CollectionBook).filter_by(collection_id=c.id).count(),
        }
        for c in rows
    ]


@collections_router.post("")
def create_collection(payload: CollectionPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = Collection(user_id=user.id, **payload.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id}


@collections_router.delete("/{collection_id}")
def delete_collection(collection_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.query(Collection).filter_by(id=collection_id, user_id=user.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="书架不存在")
    db.delete(c)
    db.commit()
    return {"success": True}


@collections_router.get("/{collection_id}/books")
def collection_books(collection_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_owned_collection(db, collection_id, user)
    rows = (
        db.query(CollectionBook)
        .filter_by(collection_id=collection_id)
        .order_by(CollectionBook.order_index.asc())
        .all()
    )
    books = {b.id: b for b in db.query(Book).filter(Book.id.in_([r.book_id for r in rows]))}
    return [book_summary(books[r.book_id]) for r in rows if r.book_id in books]


class AddBookPayload(BaseModel):
    book_id: str


@collections_router.post("/{collection_id}/books")
def add_book_to_collection(
    collection_id: str, payload: AddBookPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _get_owned_collection(db, collection_id, user)
    exists = db.query(CollectionBook).filter_by(collection_id=collection_id, book_id=payload.book_id).first()
    if exists:
        return {"success": True}
    max_order = db.query(CollectionBook).filter_by(collection_id=collection_id).count()
    db.add(CollectionBook(collection_id=collection_id, book_id=payload.book_id, order_index=max_order))
    db.commit()
    return {"success": True}


@collections_router.delete("/{collection_id}/books/{book_id}")
def remove_book_from_collection(
    collection_id: str, book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _get_owned_collection(db, collection_id, user)
    db.query(CollectionBook).filter_by(collection_id=collection_id, book_id=book_id).delete()
    db.commit()
    return {"success": True}
