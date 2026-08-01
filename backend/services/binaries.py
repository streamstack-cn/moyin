"""
binaries.py — 在 PATH 与常见安装位置中定位外部工具。

本地 macOS（Homebrew / .app）、Linux 包管理器与 Docker 镜像里的路径不一致，
仅靠 shutil.which 会在「已安装但 PATH 未含 Homebrew」时误报不可用。
"""

from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Optional


def _candidates(names: list[str], extra_paths: list[str]) -> list[str]:
    ordered: list[str] = []
    for name in names:
        ordered.append(name)
    ordered.extend(extra_paths)
    # 去重且保序
    seen: set[str] = set()
    result: list[str] = []
    for item in ordered:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _is_executable(path: str) -> bool:
    p = Path(path)
    return p.is_file() and os.access(p, os.X_OK)


@lru_cache(maxsize=16)
def find_binary(names: tuple[str, ...], extra_paths: tuple[str, ...] = ()) -> Optional[str]:
    for candidate in _candidates(list(names), list(extra_paths)):
        if "/" in candidate or candidate.startswith("~"):
            expanded = str(Path(candidate).expanduser())
            if _is_executable(expanded):
                return expanded
            continue
        found = shutil.which(candidate)
        if found:
            return found
    return None


def ebook_convert_bin() -> Optional[str]:
    return find_binary(
        ("ebook-convert",),
        (
            "/opt/homebrew/bin/ebook-convert",
            "/usr/local/bin/ebook-convert",
            "/opt/calibre/ebook-convert",
            "/Applications/calibre.app/Contents/MacOS/ebook-convert",
        ),
    )


def ebook_meta_bin() -> Optional[str]:
    return find_binary(
        ("ebook-meta",),
        (
            "/opt/homebrew/bin/ebook-meta",
            "/usr/local/bin/ebook-meta",
            "/opt/calibre/ebook-meta",
            "/Applications/calibre.app/Contents/MacOS/ebook-meta",
        ),
    )


def soffice_bin() -> Optional[str]:
    return find_binary(
        ("soffice", "libreoffice"),
        (
            "/opt/homebrew/bin/soffice",
            "/usr/local/bin/soffice",
            "/usr/bin/soffice",
            "/usr/bin/libreoffice",
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        ),
    )


def reset_cache() -> None:
    find_binary.cache_clear()
