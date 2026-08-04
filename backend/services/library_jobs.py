"""library_jobs.py — 书库扫描任务队列（防抖 / 防并发）+ 定时调度"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Optional, Set

logger = logging.getLogger("moyin.library_jobs")

_pending: Set[str] = set()
_pending_lock = threading.Lock()
_worker_started = False
_scan_lock = threading.Lock()
_cancel_flag = threading.Event()
_running_library_id: Optional[str] = None
_running_lock = threading.Lock()

_scheduler = None

SCHEDULE_ENABLED_KEY = "LIBRARY_SCAN_SCHEDULE_ENABLED"
SCHEDULE_INTERVAL_KEY = "LIBRARY_SCAN_INTERVAL_MINUTES"
WATCH_DEBOUNCE_KEY = "LIBRARY_WATCH_DEBOUNCE_SEC"


def enqueue_library_scan(library_id: str, reason: str = "manual") -> None:
    """把书库扫描放入待处理集合，由后台 worker 串行执行。"""
    # 上传抑制期间忽略监控入队，手动/定时扫描仍应放行
    if reason == "watch":
        try:
            from services.library_watcher import is_library_suppressed

            if is_library_suppressed(library_id):
                logger.info("忽略监控入队（入库抑制中）library=%s", library_id)
                return
        except Exception:  # noqa: BLE001
            pass
    _cancel_flag.clear()
    with _pending_lock:
        _pending.add(library_id)
        logger.info("入队扫描 library=%s reason=%s queue=%s", library_id, reason, len(_pending))
    _ensure_worker()


def clear_pending_library(library_id: str) -> None:
    """从扫描队列移除指定书架（不中断其他任务）。"""
    with _pending_lock:
        _pending.discard(library_id)


def enqueue_scan_all(reason: str = "schedule") -> None:
    from database import SessionLocal
    from models import Library

    db = SessionLocal()
    try:
        ids = [lib.id for lib in db.query(Library).all()]
    finally:
        db.close()
    for lid in ids:
        enqueue_library_scan(lid, reason=reason)


def request_cancel_scans() -> dict:
    """清空排队中的扫描，并请求中止当前正在进行的扫描。"""
    with _pending_lock:
        cleared = len(_pending)
        _pending.clear()
    _cancel_flag.set()
    try:
        from services import library_watcher

        library_watcher.cancel_pending_debounces()
    except Exception:  # noqa: BLE001
        pass
    with _running_lock:
        running = _running_library_id
    logger.info("请求停止扫描：cleared=%s running=%s", cleared, running)
    return {
        "cleared_queue": cleared,
        "running_library_id": running,
        "cancel_requested": True,
    }


def scan_status() -> dict:
    with _pending_lock:
        pending_count = len(_pending)
    with _running_lock:
        running = _running_library_id
    return {
        "running": running is not None,
        "running_library_id": running,
        "pending_count": pending_count,
        "busy": running is not None or pending_count > 0,
        "cancel_requested": _cancel_flag.is_set(),
    }


def _ensure_worker() -> None:
    global _worker_started
    with _pending_lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_worker_loop, name="moyin-library-scan", daemon=True)
    t.start()


def _worker_loop() -> None:
    global _running_library_id
    while True:
        library_id = None
        with _pending_lock:
            if _pending:
                library_id = _pending.pop()
        if not library_id:
            threading.Event().wait(1.0)
            continue
        if _cancel_flag.is_set():
            logger.info("跳过已取消的排队任务 library=%s", library_id)
            continue
        try:
            _run_scan_sync(library_id)
        except Exception:  # noqa: BLE001
            logger.exception("扫描失败 library=%s", library_id)


def _run_scan_sync(library_id: str) -> None:
    """在独立线程里跑 async scan_library，全局限一把锁避免重叠扫盘。"""
    global _running_library_id
    from database import SessionLocal
    from models import Library
    from services import scan_service

    with _scan_lock:
        with _running_lock:
            _running_library_id = library_id
        db = SessionLocal()
        try:
            lib = db.query(Library).filter_by(id=library_id).first()
            if not lib:
                return
            if _cancel_flag.is_set():
                logger.info("扫描开始前已取消: %s", lib.name)
                return
            logger.info("开始扫描书库: %s (%s)", lib.name, lib.root_path)
            result = asyncio.run(
                scan_service.scan_library(db, lib, cancel_check=lambda: _cancel_flag.is_set())
            )
            logger.info("扫描结束 %s → %s", lib.name, result)
        finally:
            db.close()
            with _running_lock:
                _running_library_id = None


def _get_config(db, key: str, default: str = "") -> str:
    from models import AppConfig

    row = db.query(AppConfig).filter_by(key=key).first()
    return row.value if row else default


def _get_config_bool(db, key: str, default: bool = False) -> bool:
    raw = _get_config(db, key, "true" if default else "false")
    return raw.lower() in ("1", "true", "yes", "on")


def load_schedule_settings(db) -> dict:
    interval = 60
    try:
        interval = max(5, int(_get_config(db, SCHEDULE_INTERVAL_KEY, "60") or "60"))
    except ValueError:
        interval = 60
    debounce = 8
    try:
        debounce = max(2, int(_get_config(db, WATCH_DEBOUNCE_KEY, "8") or "8"))
    except ValueError:
        debounce = 8
    return {
        "schedule_enabled": _get_config_bool(db, SCHEDULE_ENABLED_KEY, False),
        "interval_minutes": interval,
        "watch_debounce_sec": debounce,
    }


def start_scheduler() -> None:
    """按 AppConfig 启动/重建 APScheduler 定时全库扫描。"""
    global _scheduler
    from database import SessionLocal

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        logger.warning("APScheduler 不可用，定时扫描未启用")
        return

    db = SessionLocal()
    try:
        settings = load_schedule_settings(db)
    finally:
        db.close()

    stop_scheduler()
    if not settings["schedule_enabled"]:
        logger.info("定时扫描未启用")
        return

    scheduler = BackgroundScheduler()
    minutes = settings["interval_minutes"]
    scheduler.add_job(
        lambda: enqueue_scan_all("schedule"),
        IntervalTrigger(minutes=minutes),
        id="library_scan_all",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("定时扫描已启动：每 %s 分钟", minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            pass
        _scheduler = None


def restart_scheduler() -> None:
    start_scheduler()


def scheduler_status() -> dict:
    return {
        "running": _scheduler is not None and getattr(_scheduler, "running", False),
    }
