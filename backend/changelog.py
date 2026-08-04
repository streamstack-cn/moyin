"""版本更新日志：读取仓库根目录 CHANGELOG.json，最多返回最近 10 条。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("moyin.changelog")

_CHANGELOG_CANDIDATES = (
    Path(__file__).resolve().parent.parent / "CHANGELOG.json",  # 仓库根 / 容器 /app
    Path(__file__).resolve().parent / "CHANGELOG.json",
)

_MAX_ENTRIES = 10


def _load_raw() -> list[dict[str, Any]]:
    for path in _CHANGELOG_CANDIDATES:
        try:
            if not path.is_file():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [row for row in data if isinstance(row, dict)]
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("读取更新日志失败 %s: %s", path, exc)
    return []


def list_changelog(limit: int = _MAX_ENTRIES) -> list[dict[str, Any]]:
    """按文件顺序取前 N 条（约定新版本写在数组最前）。"""
    n = max(1, min(int(limit or _MAX_ENTRIES), _MAX_ENTRIES))
    entries = _load_raw()[:n]
    out: list[dict[str, Any]] = []
    for row in entries:
        version = str(row.get("version") or "").strip().lstrip("Vv")
        label = str(row.get("version_label") or (f"V{version}" if version else "")).strip()
        details_in = row.get("details") or []
        details: list[dict[str, str]] = []
        if isinstance(details_in, list):
            for item in details_in:
                if not isinstance(item, dict):
                    continue
                heading = str(item.get("heading") or "").strip()
                body = str(item.get("body") or "").strip()
                if heading or body:
                    details.append({"heading": heading, "body": body})
        highlights = row.get("highlights") or []
        if not isinstance(highlights, list):
            highlights = []
        out.append(
            {
                "version": version,
                "version_label": label,
                "date": str(row.get("date") or "").strip(),
                "title": str(row.get("title") or "").strip(),
                "highlights": [str(h).strip() for h in highlights if str(h).strip()],
                "details": details,
            }
        )
    return out
