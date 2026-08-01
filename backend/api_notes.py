"""api_notes.py — 读书笔记（Markdown，边读边写，每人每书一份长文笔记）"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import BookNote, User
from security import get_current_user

router = APIRouter(prefix="/api/notes", tags=["Notes"])


def _serialize(note: BookNote | None, book_id: str) -> dict:
    if not note:
        return {"book_id": book_id, "content": "", "updated_at": None}
    return {"book_id": note.book_id, "content": note.content, "updated_at": note.updated_at}


@router.get("/{book_id}")
def get_note(book_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    note = db.query(BookNote).filter_by(book_id=book_id, user_id=user.id).first()
    return _serialize(note, book_id)


class NotePayload(BaseModel):
    content: str = ""


@router.put("/{book_id}")
def save_note(book_id: str, payload: NotePayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    note = db.query(BookNote).filter_by(book_id=book_id, user_id=user.id).first()
    if not note:
        note = BookNote(book_id=book_id, user_id=user.id, content=payload.content)
        db.add(note)
    else:
        note.content = payload.content
    db.commit()
    db.refresh(note)
    return _serialize(note, book_id)
