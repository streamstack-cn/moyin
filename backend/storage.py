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


def resolve_stored_path(path: str | None) -> Path | None:
    """解析库内保存的文件路径，兼容本地开发时的相对路径 data/..."""
    if not path:
        return None
    raw = str(path).strip()
    if not raw:
        return None
    p = Path(raw)
    try:
        if p.is_file():
            return p
    except OSError:
        pass

    normalized = raw.replace("\\", "/").lstrip("./")
    # 旧数据：相对路径 data/covers/xxx.jpg（本地 uvicorn 写入）
    if normalized.startswith("data/"):
        candidate = DATA_DIR / normalized[len("data/") :]
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            pass
    # 仅文件名时，按封面目录兜底
    name = Path(normalized).name
    if name and name != normalized:
        for base in (COVERS_DIR, UPLOAD_DIR, CONVERTED_DIR, EXPORTS_DIR):
            candidate = base / name
            try:
                if candidate.is_file():
                    return candidate
            except OSError:
                continue
    return p
