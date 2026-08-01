"""
google_books_service.py — Google Books API 元数据检索

作为豆瓣之外的并行数据源。无 API Key 时匿名配额极低，易返回 429，
因此支持环境变量 / AppConfig 的 GOOGLE_BOOKS_API_KEY。
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://www.googleapis.com/books/v1/volumes"


class GoogleBooksError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def resolve_api_key(explicit: str | None = None) -> str:
    return (explicit or os.environ.get("GOOGLE_BOOKS_API_KEY") or "").strip()


def _pick_isbn(identifiers: list[dict]) -> str:
    for kind in ("ISBN_13", "ISBN_10"):
        for item in identifiers or []:
            if item.get("type") == kind:
                return item.get("identifier", "")
    return ""


def _normalize(item: dict) -> dict[str, Any]:
    info = item.get("volumeInfo", {}) or {}
    image_links = info.get("imageLinks", {}) or {}
    cover = image_links.get("thumbnail") or image_links.get("smallThumbnail") or ""
    cover = cover.replace("http://", "https://")
    return {
        "source": "google",
        "google_books_id": item.get("id", ""),
        "title": info.get("title", ""),
        "subtitle": info.get("subtitle", ""),
        "authors": info.get("authors", []) or [],
        "translator": "",
        "publisher": info.get("publisher", ""),
        "pub_place": "",
        "pub_date": info.get("publishedDate", ""),
        "isbn": _pick_isbn(info.get("industryIdentifiers", [])),
        "series": "",
        "page_count": info.get("pageCount", 0),
        "language": info.get("language", ""),
        "description": info.get("description", ""),
        "cover_url": cover,
        "rating": info.get("averageRating", 0) or 0,
        "categories": info.get("categories", []) or [],
    }


def _friendly_http_error(status: int, has_key: bool) -> str:
    if status == 429:
        if has_key:
            return "Google Books 配额已用尽（429），请稍后重试或更换 API Key"
        return "Google Books 匿名配额不足（429），请在管理后台配置 API Key"
    if status in (401, 403):
        return "Google Books API Key 无效或未启用 Books API（401/403）"
    if status >= 500:
        return f"Google Books 服务异常（{status}）"
    return f"Google Books 请求失败（HTTP {status}）"


async def _request_json(params: dict[str, Any], api_key: str = "") -> dict[str, Any]:
    key = resolve_api_key(api_key)
    req_params = dict(params)
    if key:
        req_params["key"] = key

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(API_BASE, params=req_params)
    except httpx.TimeoutException as exc:
        logger.warning("Google Books timeout: %s", params.get("q") or params)
        raise GoogleBooksError("Google Books 请求超时（可能网络不可达）") from exc
    except httpx.HTTPError as exc:
        logger.warning("Google Books network error: %s", exc)
        raise GoogleBooksError(f"Google Books 网络错误：{exc.__class__.__name__}") from exc

    if resp.status_code >= 400:
        msg = _friendly_http_error(resp.status_code, bool(key))
        logger.warning("Google Books HTTP %s: %s", resp.status_code, (resp.text or "")[:200])
        raise GoogleBooksError(msg, status_code=resp.status_code)

    try:
        return resp.json()
    except Exception as exc:
        raise GoogleBooksError("Google Books 返回了无法解析的数据") from exc


async def search(
    query: str,
    isbn: Optional[str] = None,
    api_key: str = "",
    max_results: int = 10,
) -> list[dict[str, Any]]:
    q = f"isbn:{isbn}" if isbn else (query or "").strip()
    if not q:
        return []
    data = await _request_json(
        {"q": q, "maxResults": max(1, min(max_results, 20)), "printType": "books"},
        api_key=api_key,
    )
    return [_normalize(item) for item in data.get("items", []) or []]


async def get_volume(volume_id: str, api_key: str = "") -> Optional[dict[str, Any]]:
    vid = (volume_id or "").strip()
    if not vid:
        return None
    key = resolve_api_key(api_key)
    params: dict[str, Any] = {}
    if key:
        params["key"] = key
    url = f"{API_BASE}/{vid}"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, params=params)
    except httpx.TimeoutException as exc:
        raise GoogleBooksError("Google Books 详情请求超时") from exc
    except httpx.HTTPError as exc:
        raise GoogleBooksError(f"Google Books 网络错误：{exc.__class__.__name__}") from exc

    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise GoogleBooksError(_friendly_http_error(resp.status_code, bool(key)), status_code=resp.status_code)
    return _normalize(resp.json())


async def get_by_isbn(isbn: str, api_key: str = "") -> Optional[dict[str, Any]]:
    results = await search(query="", isbn=isbn, api_key=api_key, max_results=3)
    return results[0] if results else None
