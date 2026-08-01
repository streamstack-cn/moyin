"""
convert_service.py — 借助 Calibre 命令行工具做格式转换与封面提取

MOBI / AZW3 / FB2 等非 Web 原生可渲染格式，转换为 EPUB 后交给前端 epub.js 阅读；
PDF 由前端 pdf.js 原生阅读，无需转换。原始文件始终保留。
"""

import logging
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from services.binaries import ebook_convert_bin, ebook_meta_bin

logger = logging.getLogger("moyin.convert")

CONVERTIBLE_FORMATS = {"mobi", "azw3", "azw", "fb2", "lit", "rtf", "docx"}
NATIVE_READABLE = {"epub", "txt", "pdf"}
PDF_FORMATS = {"pdf"}
COMIC_FORMATS = {"cbz", "cbr"}


def calibre_available() -> bool:
    return ebook_convert_bin() is not None


def calibre_bin_path() -> Optional[str]:
    return ebook_convert_bin()


def needs_conversion(file_format: str) -> bool:
    return file_format.lower() in CONVERTIBLE_FORMATS


def convert_to_epub(src_path: str, dest_path: str) -> bool:
    """调用 `ebook-convert src dest.epub`，成功返回 True"""
    bin_path = ebook_convert_bin()
    if not bin_path:
        return False
    Path(dest_path).parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [bin_path, src_path, dest_path],
            check=True,
            capture_output=True,
            timeout=300,
        )
        return Path(dest_path).exists()
    except Exception as exc:  # noqa: BLE001
        logger.warning("calibre 转换失败 %s -> %s: %s", src_path, dest_path, exc)
        return False


def extract_cover_with_calibre(src_path: str, dest_dir: str) -> Optional[str]:
    """用 ebook-meta --get-cover 提取封面（对 PDF/MOBI/EPUB 等均有效）。"""
    meta_bin = ebook_meta_bin()
    if not meta_bin:
        return None
    Path(dest_dir).mkdir(parents=True, exist_ok=True)
    dest_path = Path(dest_dir) / f"{uuid.uuid4().hex}.jpg"
    try:
        subprocess.run(
            [meta_bin, src_path, "--get-cover", str(dest_path)],
            check=True,
            capture_output=True,
            timeout=120,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("calibre 提取封面失败 %s: %s", src_path, exc)
        if dest_path.exists():
            dest_path.unlink(missing_ok=True)
        return None
    if dest_path.exists() and dest_path.stat().st_size > 0:
        return str(dest_path)
    dest_path.unlink(missing_ok=True)
    return None


def extract_calibre_metadata(src_path: str) -> dict:
    """用 `ebook-meta` 读取内嵌元数据，作为兜底的自动填充来源（无需联网）"""
    meta_bin = ebook_meta_bin()
    if not meta_bin:
        return {}
    try:
        proc = subprocess.run(
            [meta_bin, src_path], check=True, capture_output=True, timeout=60, text=True
        )
    except Exception:
        return {}

    meta: dict = {}
    for line in proc.stdout.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if not value:
            continue
        if "title" in key and "sub" not in key:
            meta["title"] = value
        elif key.startswith("author"):
            meta["authors"] = [a.strip() for a in value.split("&") if a.strip()]
        elif key.startswith("publisher"):
            meta["publisher"] = value
        elif key.startswith("published"):
            meta["pub_date"] = value
        elif key.startswith("isbn") or (key.startswith("identifiers") and "isbn" in value.lower()):
            meta["isbn"] = value.replace("isbn:", "").strip()
        elif key.startswith("languages"):
            meta["language"] = value
        elif key.startswith("comments"):
            meta["description"] = value
    return meta
