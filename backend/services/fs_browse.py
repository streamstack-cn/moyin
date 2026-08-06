"""
fs_browse.py — 供"浏览挂载目录、选择文件夹作为书架"功能使用的安全目录列举

用法类似 Komga：先把宿主机上的电子书目录挂载到容器内的固定路径
（默认 /library-source，可用环境变量 MOYIN_LIBRARY_ROOT 覆盖），
管理员在前端一层层点进子目录，选中某个文件夹后即可创建一个「书架」（Library），
书架的显示名称（映射名）与实际文件夹名解耦，可随时重命名。
"""

import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger("moyin.fs_browse")

MOUNT_ROOT = Path(os.environ.get("MOYIN_LIBRARY_ROOT", "/library-source")).resolve()


def resolve_book_file_path(stored: Optional[str]) -> Optional[str]:
    """把库内保存的电子书绝对路径解析到当前挂载根下的真实文件。

    支持两种常见挂载互迁而不丢书：
    - 推荐：宿主机书库 → /library-source（可不设 MOYIN_LIBRARY_ROOT）
    - 兼容：宿主机书库 → 自定义路径，并设 MOYIN_LIBRARY_ROOT 与之相同

    例如库内是 /Volumes/8T/计算机/a.epub，当前根是 /library-source，
    会尝试命中 /library-source/计算机/a.epub。
    """
    if not stored:
        return None
    raw = str(stored).strip()
    if not raw:
        return None
    p = Path(raw).expanduser()
    try:
        if p.is_file():
            return str(p.resolve())
    except OSError:
        pass

    if not MOUNT_ROOT.exists():
        return None

    parts = p.parts
    start = 1 if parts and parts[0] == "/" else 0
    # 优先最长相对路径，避免仅靠文件名误匹配
    for i in range(start, len(parts)):
        candidate = MOUNT_ROOT.joinpath(*parts[i:])
        try:
            if candidate.is_file():
                return str(candidate.resolve())
        except OSError:
            continue
    return None


def heal_book_file_paths(db) -> int:
    """启动时把失效的 file_path 重绑到当前 MOUNT_ROOT；返回重写条数。"""
    from models import Book

    fixed = 0
    books = db.query(Book).filter(Book.file_path.isnot(None)).all()
    for book in books:
        old = book.file_path or ""
        if not old:
            continue
        try:
            if Path(old).expanduser().is_file():
                continue
        except OSError:
            pass
        resolved = resolve_book_file_path(old)
        if resolved and resolved != old:
            logger.info("书库路径自愈 %s → %s", old, resolved)
            book.file_path = resolved
            fixed += 1
    if fixed:
        db.commit()
    return fixed


def _safe_resolve(rel_path: str) -> Path:
    """把前端传来的相对路径解析为容器内绝对路径，并禁止越出挂载根目录"""
    rel_path = (rel_path or "").strip().lstrip("/")
    target = (MOUNT_ROOT / rel_path).resolve()
    if target != MOUNT_ROOT and MOUNT_ROOT not in target.parents:
        raise ValueError("非法路径")
    return target


def browse(rel_path: str = "") -> dict:
    if not MOUNT_ROOT.exists():
        return {
            "mount_root": str(MOUNT_ROOT),
            "mount_ready": False,
            "path": "",
            "parent": None,
            "absolute_path": "",
            "entries": [],
        }

    target = _safe_resolve(rel_path)
    if not target.exists() or not target.is_dir():
        raise FileNotFoundError(str(target))

    entries = []
    permission_denied = False
    try:
        children = sorted(target.iterdir(), key=lambda p: p.name.lower())
    except PermissionError:
        # 常见于 macOS Docker Desktop/OrbStack 未对该宿主机路径授予文件共享权限：
        # 挂载点本身存在，但读取子项时被拒绝，需与"目录本来就是空的"区分开，否则用户会误以为是代码 bug
        children = []
        permission_denied = True
    for child in children:
        if child.name.startswith("."):
            continue
        try:
            is_dir = child.is_dir()
        except PermissionError:
            permission_denied = True
            continue
        if not is_dir:
            continue
        entries.append({"name": child.name, "path": str(child.relative_to(MOUNT_ROOT))})

    rel = "" if target == MOUNT_ROOT else str(target.relative_to(MOUNT_ROOT))
    if target == MOUNT_ROOT:
        parent = None
    else:
        parent = "" if target.parent == MOUNT_ROOT else str(target.parent.relative_to(MOUNT_ROOT))

    return {
        "mount_root": str(MOUNT_ROOT),
        "mount_ready": True,
        "path": rel,
        "parent": parent,
        "absolute_path": str(target),
        "entries": entries,
        "permission_denied": permission_denied,
    }
