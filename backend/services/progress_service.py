"""阅读进度状态推导：按百分比自动在 unread / reading / finished 间切换。"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import ReadingProgress

# 进度达到该阈值视为读完（书末常有引用/附录，98% 即可标已读完）
FINISHED_THRESHOLD = 0.98
# 未满 3% 一律视为未读：不进「继续阅读」、不算「在读」（含 AI 伴读等）
READING_MIN_PERCENT = 0.03
# 兼容旧名
CONTINUE_READING_MIN = READING_MIN_PERCENT


def normalize_percent(raw: float | None) -> float:
    """统一为 0~1；兼容历史误存成 0~100 的数据。"""
    try:
        p = float(raw or 0)
    except (TypeError, ValueError):
        return 0.0
    if p > 1.5:
        p = p / 100.0
    return max(0.0, min(1.0, p))


def status_from_percent(raw: float | None, *, stored_status: Optional[str] = None) -> str:
    """由进度推导对外展示/筛选用的状态（未满 3% → unread）。"""
    p = normalize_percent(raw)
    if stored_status == "finished" or p >= FINISHED_THRESHOLD:
        return "finished"
    if p >= READING_MIN_PERCENT:
        return "reading"
    return "unread"


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
        elif explicit_status == "reading":
            # 手动标在读但进度不足 3%：仍按未读落库，避免各入口不一致
            p = normalize_percent(row.percent)
            row.percent = p
            if p < READING_MIN_PERCENT:
                row.status = "unread"
        return

    p = normalize_percent(row.percent)
    row.percent = p
    if p >= FINISHED_THRESHOLD:
        row.status = "finished"
        row.percent = 1.0
    elif p >= READING_MIN_PERCENT:
        row.status = "reading"
    else:
        # 0~3%：保留 location/percent 便于续读，但不算在读
        row.status = "unread"


def heal_finished_progress(db: Session, user_id: Optional[str] = None) -> int:
    """修正进度与 status 不一致的旧数据（不改 updated_at）。"""
    n = 0
    # 进度已满但仍标在读 → finished
    q_fin = db.query(ReadingProgress).filter(
        ReadingProgress.status == "reading",
        or_(
            ReadingProgress.percent >= FINISHED_THRESHOLD,
            ReadingProgress.percent >= 98,  # 误存为百分数
        ),
    )
    if user_id:
        q_fin = q_fin.filter(ReadingProgress.user_id == user_id)
    n += int(
        q_fin.update({"status": "finished", "percent": 1.0}, synchronize_session="fetch") or 0
    )

    # 进度未满 3% 却标在读 → unread（保留 percent/location）
    q_low = db.query(ReadingProgress).filter(
        ReadingProgress.status == "reading",
        ReadingProgress.percent < READING_MIN_PERCENT,
    )
    if user_id:
        q_low = q_low.filter(ReadingProgress.user_id == user_id)
    n += int(q_low.update({"status": "unread"}, synchronize_session="fetch") or 0)

    # 进度已达在读门槛却仍标未读 → reading（补齐历史漏同步）
    q_up = db.query(ReadingProgress).filter(
        ReadingProgress.status == "unread",
        ReadingProgress.percent >= READING_MIN_PERCENT,
        ReadingProgress.percent < FINISHED_THRESHOLD,
    )
    if user_id:
        q_up = q_up.filter(ReadingProgress.user_id == user_id)
    n += int(q_up.update({"status": "reading"}, synchronize_session="fetch") or 0)

    if n:
        db.commit()
    return n
