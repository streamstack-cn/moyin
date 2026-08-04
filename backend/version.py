"""应用版本号（单一来源：仓库根目录 VERSION）。"""

from pathlib import Path

_VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"


def _read_version() -> str:
    try:
        text = _VERSION_FILE.read_text(encoding="utf-8").strip()
        if text:
            return text.lstrip("Vv")
    except OSError:
        pass
    return "0.5"


__version__ = _read_version()
# 页面展示用，例如 V0.4
APP_VERSION_LABEL = f"V{__version__}"
