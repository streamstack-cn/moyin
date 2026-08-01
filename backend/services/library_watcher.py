"""library_watcher.py — 书库目录变动监控（watchdog）

对 scan_mode=watch 的书架监听文件系统事件，防抖后触发扫描（含搬家重绑）。
"""

from __future__ import annotations

import asyncio
import logging
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger("moyin.watch")

_observer = None
_handlers: dict[str, "DebouncedScanHandler"] = {}
_loop: Optional[asyncio.AbstractEventLoop] = None
_lock = threading.Lock()

try:
    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer

    WATCHDOG_AVAILABLE = True
except ImportError:  # pragma: no cover
    FileSystemEventHandler = object  # type: ignore
    Observer = None  # type: ignore
    WATCHDOG_AVAILABLE = False


SUPPORTED_SUFFIXES = {
    ".epub",
    ".txt",
    ".pdf",
    ".mobi",
    ".azw3",
    ".azw",
    ".fb2",
    ".cbz",
    ".cbr",
}


def _is_book_event(path: str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_SUFFIXES


class DebouncedScanHandler(FileSystemEventHandler):  # type: ignore[misc,valid-type]
    def __init__(self, library_id: str, debounce_sec: float = 8.0):
        super().__init__()
        self.library_id = library_id
        self.debounce_sec = debounce_sec
        self._timer: Optional[threading.Timer] = None
        self._timer_lock = threading.Lock()

    def _schedule(self) -> None:
        with self._timer_lock:
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.debounce_sec, self._fire)
            self._timer.daemon = True
            self._timer.start()

    def _fire(self) -> None:
        logger.info("目录变动触发扫描: library=%s", self.library_id)
        from services.library_jobs import enqueue_library_scan

        enqueue_library_scan(self.library_id, reason="watch")

    def on_created(self, event):  # noqa: ANN001
        if getattr(event, "is_directory", False):
            return
        if _is_book_event(getattr(event, "src_path", "")):
            self._schedule()

    def on_moved(self, event):  # noqa: ANN001
        if getattr(event, "is_directory", False):
            return
        if _is_book_event(getattr(event, "src_path", "")) or _is_book_event(
            getattr(event, "dest_path", "")
        ):
            self._schedule()

    def on_deleted(self, event):  # noqa: ANN001
        if getattr(event, "is_directory", False):
            return
        if _is_book_event(getattr(event, "src_path", "")):
            self._schedule()

    def on_modified(self, event):  # noqa: ANN001
        # 大文件拷贝过程中会频繁 modified，靠 debounce 合并
        if getattr(event, "is_directory", False):
            return
        if _is_book_event(getattr(event, "src_path", "")):
            self._schedule()


def start_watchers(debounce_sec: float = 8.0) -> None:
    """根据数据库中 scan_mode=watch 的书架启动监听。"""
    global _observer
    if not WATCHDOG_AVAILABLE:
        logger.warning("未安装 watchdog，目录监控不可用（pip install watchdog）")
        return

    from database import SessionLocal
    from models import Library

    stop_watchers()
    db = SessionLocal()
    try:
        libs = db.query(Library).filter(Library.scan_mode == "watch").all()
        observer = Observer()
        with _lock:
            _handlers.clear()
            for lib in libs:
                root = Path(lib.root_path)
                if not root.exists():
                    logger.warning("监控跳过（目录不存在）: %s", lib.root_path)
                    continue
                handler = DebouncedScanHandler(lib.id, debounce_sec=debounce_sec)
                observer.schedule(handler, str(root), recursive=True)
                _handlers[lib.id] = handler
                logger.info("开始监控书库 %s → %s", lib.name, lib.root_path)
            if _handlers:
                observer.start()
                _observer = observer
            else:
                observer = None
                _observer = None
    finally:
        db.close()


def refresh_watchers(debounce_sec: float = 8.0) -> None:
    start_watchers(debounce_sec=debounce_sec)


def cancel_pending_debounces() -> None:
    """取消尚未触发的防抖扫描定时器（不停止监听本身）。"""
    with _lock:
        for handler in _handlers.values():
            with handler._timer_lock:
                if handler._timer:
                    handler._timer.cancel()
                    handler._timer = None


def stop_watchers() -> None:
    global _observer
    with _lock:
        if _observer is not None:
            try:
                _observer.stop()
                _observer.join(timeout=5)
            except Exception:  # noqa: BLE001
                pass
            _observer = None
        for handler in _handlers.values():
            with handler._timer_lock:
                if handler._timer:
                    handler._timer.cancel()
        _handlers.clear()


def watcher_status() -> dict:
    return {
        "available": WATCHDOG_AVAILABLE,
        "watching": list(_handlers.keys()),
        "count": len(_handlers),
    }
