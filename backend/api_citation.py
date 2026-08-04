"""
api_citation.py — 「引用篮」写作工作台

读书时把引文存入引用篮（可跨书累积、可分组保存为写作项目），写作时一键导出：
  - Word 真脚注草稿（按 PDF 规范自动处理"同上"/重复引用简化）
  - 去重、按姓氏笔画排序的参考书目 docx
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import storage
from database import get_db
from models import Book, CitationBasketItem, CitationProject, User
from security import get_current_user
from serializers import _authors_list, cover_url_for
from services import citation_service, docx_export_service

router = APIRouter(prefix="/api/citation", tags=["Citation"])


def _get_owned_project(db: Session, project_id: str, user: User) -> CitationProject:
    """引用篮项目（写作项目）为用户私有数据，所有跨条目操作都必须先校验归属，
    避免多用户场景下 A 用户凭 project_id/item_id 读取或篡改 B 用户的写作素材。"""
    project = db.query(CitationProject).filter_by(id=project_id, user_id=user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


def _get_owned_item(db: Session, item_id: str, user: User) -> CitationBasketItem:
    item = (
        db.query(CitationBasketItem)
        .join(CitationProject, CitationProject.id == CitationBasketItem.project_id)
        .filter(CitationBasketItem.id == item_id, CitationProject.user_id == user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="条目不存在")
    return item


# ── 写作项目（引用篮分组） ─────────────────────────────────────────────────
class ProjectPayload(BaseModel):
    name: str = "默认引用篮"
    script_variant: str = "simplified"


@router.get("/projects")
def list_projects(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from sqlalchemy import func

    rows = db.query(CitationProject).filter_by(user_id=user.id).order_by(CitationProject.created_at.asc()).all()
    if not rows:
        default = CitationProject(user_id=user.id, name="默认引用篮")
        db.add(default)
        db.commit()
        db.refresh(default)
        rows = [default]
    # 「默认引用篮」置顶，其余按创建时间
    rows = sorted(rows, key=lambda p: (0 if p.name == "默认引用篮" else 1, p.created_at))
    counts = dict(
        db.query(CitationBasketItem.project_id, func.count(CitationBasketItem.id))
        .filter(CitationBasketItem.project_id.in_([p.id for p in rows]))
        .group_by(CitationBasketItem.project_id)
        .all()
    )
    return [
        {
            "id": p.id,
            "name": p.name,
            "script_variant": p.script_variant,
            "created_at": p.created_at,
            "item_count": int(counts.get(p.id, 0)),
        }
        for p in rows
    ]


@router.post("/projects")
def create_project(payload: ProjectPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = CitationProject(user_id=user.id, name=payload.name, script_variant=payload.script_variant)
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "name": p.name}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.query(CitationProject).filter_by(id=project_id, user_id=user.id).first()
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    db.delete(p)
    db.commit()
    return {"success": True}


# ── 引用篮条目 ──────────────────────────────────────────────────────────
def _item_dict(item: CitationBasketItem, book: Optional[Book]) -> dict:
    return {
        "id": item.id,
        "project_id": item.project_id,
        "book_id": item.book_id,
        "book_title": book.title if book else "",
        "book_authors": _authors_list(book) if book else [],
        "book_cover_url": cover_url_for(book) if book else "",
        "quoted_text": item.quoted_text,
        "page_no": item.page_no,
        "cfi_range": item.cfi_range or "",
        "group_name": item.group_name or "",
        "order_index": item.order_index,
        "created_at": item.created_at,
    }


@router.get("/projects/{project_id}/items")
def list_items(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_owned_project(db, project_id, user)
    rows = (
        db.query(CitationBasketItem)
        .filter_by(project_id=project_id)
        .order_by(CitationBasketItem.order_index.asc(), CitationBasketItem.created_at.asc())
        .all()
    )
    books = {b.id: b for b in db.query(Book).filter(Book.id.in_([r.book_id for r in rows]))} if rows else {}
    return [_item_dict(r, books.get(r.book_id)) for r in rows]


@router.get("/projects/{project_id}/groups")
def list_groups(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """返回该项目下已使用过的分组名列表（用于新增条目时的下拉建议）"""
    _get_owned_project(db, project_id, user)
    rows = (
        db.query(CitationBasketItem.group_name)
        .filter(CitationBasketItem.project_id == project_id, CitationBasketItem.group_name != "")
        .distinct()
        .all()
    )
    return sorted({r[0] for r in rows})


class ItemPayload(BaseModel):
    project_id: str
    book_id: str
    quoted_text: str = ""
    page_no: str = ""
    cfi_range: str = ""
    group_name: str = ""
    highlight_id: Optional[str] = None


@router.post("/items")
def add_item(payload: ItemPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_owned_project(db, payload.project_id, user)
    max_order = (
        db.query(CitationBasketItem)
        .filter_by(project_id=payload.project_id)
        .count()
    )
    item = CitationBasketItem(**payload.model_dump(), order_index=max_order)
    db.add(item)
    db.commit()
    db.refresh(item)
    book = db.query(Book).filter_by(id=item.book_id).first()
    return _item_dict(item, book)


class ItemUpdatePayload(BaseModel):
    quoted_text: Optional[str] = None
    page_no: Optional[str] = None
    group_name: Optional[str] = None


@router.patch("/items/{item_id}")
def update_item(
    item_id: str, payload: ItemUpdatePayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    item = _get_owned_item(db, item_id, user)
    if payload.quoted_text is not None:
        item.quoted_text = payload.quoted_text
    if payload.page_no is not None:
        item.page_no = payload.page_no
    if payload.group_name is not None:
        item.group_name = payload.group_name.strip()
    db.commit()
    return {"success": True}


class RenameGroupPayload(BaseModel):
    old_name: str
    new_name: str


@router.post("/projects/{project_id}/groups/rename")
def rename_group(
    project_id: str, payload: RenameGroupPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """批量重命名一个分组下的所有条目（分组本身不是独立实体，仅是条目上的标签）"""
    _get_owned_project(db, project_id, user)
    new_name = payload.new_name.strip()
    db.query(CitationBasketItem).filter_by(project_id=project_id, group_name=payload.old_name).update(
        {"group_name": new_name}
    )
    db.commit()
    return {"success": True}


@router.delete("/items/{item_id}")
def delete_item(
    item_id: str,
    also_highlight: bool = Query(True, description="若条目关联高亮，一并删除该书内高亮"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from models import Highlight

    item = _get_owned_item(db, item_id, user)
    hl_id = item.highlight_id
    db.delete(item)
    removed_highlight = False
    if also_highlight and hl_id:
        hl = db.query(Highlight).filter_by(id=hl_id, user_id=user.id).first()
        if hl:
            db.delete(hl)
            removed_highlight = True
    db.commit()
    return {"success": True, "removed_highlight": removed_highlight}


class ReorderPayload(BaseModel):
    item_ids: list[str]


@router.post("/projects/{project_id}/reorder")
def reorder_items(
    project_id: str, payload: ReorderPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _get_owned_project(db, project_id, user)
    for index, item_id in enumerate(payload.item_ids):
        db.query(CitationBasketItem).filter_by(id=item_id, project_id=project_id).update({"order_index": index})
    db.commit()
    return {"success": True}


# ── 导出 ───────────────────────────────────────────────────────────────
def _build_entries(db: Session, project_id: str) -> list[citation_service.CitationEntry]:
    rows = (
        db.query(CitationBasketItem)
        .filter_by(project_id=project_id)
        .order_by(CitationBasketItem.order_index.asc())
        .all()
    )
    entries = []
    for r in rows:
        book = db.query(Book).filter_by(id=r.book_id).first()
        if not book:
            continue
        ref = citation_service.BookRef.from_book(book)
        entries.append(citation_service.CitationEntry(book=ref, page_no=r.page_no, quoted_text=r.quoted_text))
    return entries


@router.get("/projects/{project_id}/export/footnotes")
def export_footnotes(
    project_id: str, variant: str = "simplified", db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    project = _get_owned_project(db, project_id, user)
    entries = _build_entries(db, project_id)
    if not entries:
        raise HTTPException(status_code=400, detail="引用篮为空")

    rendered = citation_service.render_footnotes(entries, variant)
    dest = str(storage.EXPORTS_DIR / f"footnotes_{uuid.uuid4().hex}.docx")
    docx_export_service.render_footnote_docx(rendered, dest, doc_title=f"{project.name}·脚注导出", project_name=project.name)
    return FileResponse(
        dest,
        filename=f"{project.name}_脚注.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.get("/projects/{project_id}/export/bibliography")
def export_bibliography(
    project_id: str, variant: str = "simplified", db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    project = _get_owned_project(db, project_id, user)
    entries = _build_entries(db, project_id)
    if not entries:
        raise HTTPException(status_code=400, detail="引用篮为空")

    items = citation_service.render_bibliography(entries, variant)
    dest = str(storage.EXPORTS_DIR / f"bibliography_{uuid.uuid4().hex}.docx")
    docx_export_service.render_bibliography_docx(items, dest, doc_title=f"{project.name}·参考书目")
    return FileResponse(
        dest,
        filename=f"{project.name}_参考书目.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.get("/projects/{project_id}/preview")
def preview_citations(
    project_id: str, variant: str = "simplified", db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """写作页实时预览：不落盘，直接返回格式化后的脚注 + 参考书目文本"""
    _get_owned_project(db, project_id, user)
    entries = _build_entries(db, project_id)
    footnotes = citation_service.render_footnotes(entries, variant)
    bibliography = citation_service.render_bibliography(entries, variant)
    return {
        "footnotes": [{"order": f.order, "text": f.text, "quoted_text": f.quoted_text} for f in footnotes],
        "bibliography": [{"text": b.text, "stroke_estimated": b.stroke_estimated} for b in bibliography],
    }


@router.get("/quick-footnote")
def quick_footnote(
    book_id: str = Query(..., min_length=1),
    page_no: str = "",
    variant: str = "simplified",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """根据当前书籍元数据 + 页码，生成一条完整脚注文本（供阅读器一键复制）。"""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    entries = [
        citation_service.CitationEntry(
            book=citation_service.BookRef.from_book(book),
            page_no=page_no or "",
        )
    ]
    rendered = citation_service.render_footnotes(entries, variant)
    text = rendered[0].text if rendered else ""
    return {"text": text, "page_no": page_no or ""}
