"""阅读进度状态推导：按百分比自动在 unread / reading / finished 间切换。"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import ReadingProgress

# 进度达到该阈值视为读完（兼容 epub 末页略低于 1.0）
FINISHED_THRESHOLD = 0.985


def normalize_percent(raw: float | None) -> float:
    """统一为 0~1；兼容历史误存成 0~100 的数据。"""
    try:
        p = float(raw or 0)
    except (TypeError, ValueError):
        return 0.0
    if p > 1.5:
        p = p / 100.0
    return max(0.0, min(1.0, p))


def sync_status_from_percent(row: ReadingProgress, *, explicit_status: Optional[str] = None) -> None:
    """根据进度同步 status。显式 unread 会清空进度；读完自动标 finished。"""
    if explicit_status is not None:
        row.status = explicit_status
        if explicit_status == "unread":
            row.location = ""
            row.percent = 0.0
        elif explicit_status == "finished":
            row.percent = max(normalize_percent(row.percent), 1.0)
            if row.percent < FINISHED_THRESHOLD:
                row.percent = 1.0
        return

    p = normalize_percent(row.percent)
    row.percent = p
    if p >= FINISHED_THRESHOLD:
        row.status = "finished"
        row.percent = 1.0
    elif p > 0:
        row.status = "reading"
    elif row.status != "finished":
        # 进度为 0：保持 unread；若曾在读则仍算 reading（例如重启阅读瞬间）
        if row.status not in ("reading", "unread"):
            row.status = "unread"


def heal_finished_progress(db: Session, user_id: Optional[str] = None) -> int:
    """把「进度已满但仍标在读」的旧数据修正为 finished（不改 updated_at）。"""
    q = db.query(ReadingProgress).filter(
        ReadingProgress.status == "reading",
        or_(
            ReadingProgress.percent >= FINISHED_THRESHOLD,
            ReadingProgress.percent >= 98,  # 误存为百分数
        ),
    )
    if user_id:
        q = q.filter(ReadingProgress.user_id == user_id)
    # bulk update 不触发 Column.onupdate，保留原先读完时间供「本月读完」统计
    n = q.update({"status": "finished", "percent": 1.0}, synchronize_session="fetch")
    if n:
        db.commit()
    return int(n or 0)
