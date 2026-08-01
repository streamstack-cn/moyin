"""api_search.py — 书内关键词搜索 / 跨书全文检索"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import User
from security import get_current_user
from services import search_service

router = APIRouter(prefix="/api/search", tags=["Search"])


@router.get("/book/{book_id}")
def search_in_book(
    book_id: str,
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return {"results": search_service.search_in_book(db, book_id, q)}


@router.get("/library")
def search_library(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """跨书全文检索——写作时想不起一句话出自哪本书时使用"""
    return {"results": search_service.search_across_library(db, q)}


@router.get("/global")
def search_global(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """首页统一搜索：书籍 / 高亮笔记 / 引用篮（脚注）"""
    return search_service.search_global(db, user.id, q)
