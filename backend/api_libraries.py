"""api_libraries.py — 书库（本地目录）管理与扫描"""

from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Book, Library, User
from security import get_current_user, require_admin
from services import fs_browse
from services import library_jobs, library_watcher

router = APIRouter(prefix="/api/libraries", tags=["Libraries"])


class LibraryPayload(BaseModel):
    name: str
    root_path: str
    scan_mode: str = "manual"  # manual | watch


@router.get("/browse")
def browse_mount(path: str = "", user: User = Depends(require_admin)):
    """浏览挂载到容器内的宿主机目录，供选择文件夹作为书架使用（类似 Komga 的目录选择器）"""
    try:
        return fs_browse.browse(path)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="目录不存在")


@router.get("")
def list_libraries(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    libs = db.query(Library).order_by(Library.order_index.asc(), Library.created_at.desc()).all()
    # 用 COUNT 聚合，避免 len(lib.books) 把整表书籍加载进内存（扫描时会严重拖慢）
    counts = dict(
        db.query(Book.library_id, func.count(Book.id)).group_by(Book.library_id).all()
    )
    return [
        {
            "id": lib.id,
            "name": lib.name,
            "root_path": lib.root_path,
            "scan_mode": lib.scan_mode,
            "order_index": lib.order_index or 0,
            "last_scanned_at": lib.last_scanned_at,
            "book_count": int(counts.get(lib.id, 0)),
        }
        for lib in libs
    ]


def _refresh_watch_from_db(db: Session) -> None:
    settings = library_jobs.load_schedule_settings(db)
    library_watcher.refresh_watchers(debounce_sec=float(settings["watch_debounce_sec"]))


@router.post("")
def create_library(payload: LibraryPayload, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    mode = payload.scan_mode if payload.scan_mode in ("manual", "watch") else "manual"
    lib = Library(name=payload.name, root_path=payload.root_path, scan_mode=mode)
    db.add(lib)
    db.commit()
    db.refresh(lib)
    if mode == "watch":
        _refresh_watch_from_db(db)
        library_jobs.enqueue_library_scan(lib.id, reason="create-watch")
    return {"id": lib.id}


class LibraryUpdatePayload(BaseModel):
    name: Optional[str] = None
    scan_mode: Optional[str] = None


@router.patch("/{library_id}")
def update_library(
    library_id: str, payload: LibraryUpdatePayload, db: Session = Depends(get_db), user: User = Depends(require_admin)
):
    """重命名书架 / 切换监控模式"""
    lib = db.query(Library).filter_by(id=library_id).first()
    if not lib:
        raise HTTPException(status_code=404, detail="书库不存在")
    if payload.name is not None and payload.name.strip():
        lib.name = payload.name.strip()
    mode_changed = False
    if payload.scan_mode is not None:
        if payload.scan_mode not in ("manual", "watch"):
            raise HTTPException(status_code=400, detail="scan_mode 仅支持 manual / watch")
        if lib.scan_mode != payload.scan_mode:
            lib.scan_mode = payload.scan_mode
            mode_changed = True
    db.commit()
    if mode_changed:
        _refresh_watch_from_db(db)
        if lib.scan_mode == "watch":
            library_jobs.enqueue_library_scan(lib.id, reason="enable-watch")
    return {"success": True, "scan_mode": lib.scan_mode}


@router.delete("/{library_id}")
def delete_library(library_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    lib = db.query(Library).filter_by(id=library_id).first()
    if not lib:
        raise HTTPException(status_code=404, detail="书库不存在")
    db.delete(lib)
    db.commit()
    _refresh_watch_from_db(db)
    return {"success": True}


@router.get("/scan/status")
def get_scan_status(user: User = Depends(require_admin)):
    """当前扫描队列 / 是否在跑（供前端显示停止按钮）。"""
    status = library_jobs.scan_status()
    status["scheduler"] = library_jobs.scheduler_status()
    return status


@router.post("/scan/stop")
def stop_scan(user: User = Depends(require_admin)):
    """清空排队并请求中止正在进行的扫描（已入库的书会保留）。"""
    result = library_jobs.request_cancel_scans()
    return {"success": True, "detail": "已请求停止扫描", **result}


@router.post("/watch/disable-all")
def disable_all_watch(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """关闭全部书架的目录监控，并关闭全局定时全库扫描。"""
    from models import AppConfig

    libs = db.query(Library).filter(Library.scan_mode == "watch").all()
    for lib in libs:
        lib.scan_mode = "manual"
    row = db.query(AppConfig).filter_by(key=library_jobs.SCHEDULE_ENABLED_KEY).first()
    if row:
        row.value = "false"
    else:
        db.add(AppConfig(key=library_jobs.SCHEDULE_ENABLED_KEY, value="false"))
    db.commit()
    library_jobs.stop_scheduler()
    _refresh_watch_from_db(db)
    # 同时停掉正在进行/排队的扫描，避免摄影大库继续入库
    cancel = library_jobs.request_cancel_scans()
    return {
        "success": True,
        "disabled_watch_count": len(libs),
        "schedule_disabled": True,
        **cancel,
    }


@router.post("/{library_id}/scan")
def scan_library(
    library_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    lib = db.query(Library).filter_by(id=library_id).first()
    if not lib:
        raise HTTPException(status_code=404, detail="书库不存在")
    library_jobs.enqueue_library_scan(library_id, reason="manual")
    return {"success": True, "detail": "扫描已在后台开始"}


@router.post("/scan-all")
def scan_all_libraries(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    library_jobs.enqueue_scan_all(reason="manual-all")
    return {"success": True, "detail": "已排队扫描全部书库"}
class ReorderPayload(BaseModel):
    library_ids: List[str]

@router.put("/reorder")
def reorder_libraries(payload: ReorderPayload, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    for i, lib_id in enumerate(payload.library_ids):
        db.query(Library).filter(Library.id == lib_id).update({"order_index": i})
    db.commit()
    return {"ok": True}
