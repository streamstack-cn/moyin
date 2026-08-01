"""storage.py — 统一管理容器内的数据落盘路径"""

from pathlib import Path

from database import DATA_DIR

UPLOAD_DIR = DATA_DIR / "uploads"
CONVERTED_DIR = DATA_DIR / "converted"
COVERS_DIR = DATA_DIR / "covers"
EXPORTS_DIR = DATA_DIR / "exports"

for _dir in (UPLOAD_DIR, CONVERTED_DIR, COVERS_DIR, EXPORTS_DIR):
    _dir.mkdir(parents=True, exist_ok=True)


def book_format_from_name(filename: str) -> str:
    return Path(filename).suffix.lstrip(".").lower()
