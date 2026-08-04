"""
google_books_service.py — Google Books API 元数据检索

作为豆瓣之外的并行数据源。无 API Key 时匿名配额极低，易返回 429，
因此支持环境变量 / AppConfig 的 GOOGLE_BOOKS_API_KEY。
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://www.googleapis.com/books/v1/volumes"
# 429 日配额用尽时重试无意义；503/502 多为短暂抖动
_RETRYABLE_STATUS = {408, 425, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3


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


def _pick_cover(info: dict, volume_id: str) -> str:
    """搜索接口常漏掉 imageLinks（尤其 ISBN 首条）；有 volumeId 时可拼出封面 URL。"""
    image_links = info.get("imageLinks") or {}
    for key in ("thumbnail", "small", "smallThumbnail", "medium", "large"):
        cover = (image_links.get(key) or "").strip()
        if cover:
            return cover.replace("http://", "https://")
    vid = (volume_id or "").strip()
    if not vid:
        return ""
    # Google Books 内容图：与 API thumbnail 同源，不依赖 search 是否返回 imageLinks
    return (
        f"https://books.google.com/books/content?id={vid}"
        f"&printsec=frontcover&img=1&zoom=1&source=gbs_api"
    )


def _normalize(item: dict) -> dict[str, Any]:
    info = item.get("volumeInfo", {}) or {}
    volume_id = item.get("id", "") or ""
    return {
        "source": "google",
        "google_books_id": volume_id,
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
        "cover_url": _pick_cover(info, volume_id),
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
    if status == 503:
        return "Google Books 暂时不可用（503），通常与网络/服务端有关，不是 API Key 配置错误，请稍后重试"
    if status >= 500:
        return f"Google Books 服务暂时异常（{status}），请稍后重试"
    return f"Google Books 请求失败（HTTP {status}）"


async def _request_json(params: dict[str, Any], api_key: str = "") -> dict[str, Any]:
    key = resolve_api_key(api_key)
    req_params = dict(params)
    if key:
        req_params["key"] = key

    last_err: Optional[GoogleBooksError] = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(API_BASE, params=req_params)
        except httpx.TimeoutException as exc:
            last_err = GoogleBooksError("Google Books 请求超时（可能网络不可达）")
            logger.warning("Google Books timeout attempt=%s q=%s", attempt, params.get("q") or "")
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(0.4 * attempt)
                continue
            raise last_err from exc
        except httpx.HTTPError as exc:
            last_err = GoogleBooksError(f"Google Books 网络错误：{exc.__class__.__name__}")
            logger.warning("Google Books network error attempt=%s: %s", attempt, exc.__class__.__name__)
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(0.4 * attempt)
                continue
            raise last_err from exc

        if resp.status_code < 400:
            try:
                return resp.json()
            except Exception as exc:
                raise GoogleBooksError("Google Books 返回了无法解析的数据") from exc

        msg = _friendly_http_error(resp.status_code, bool(key))
        logger.warning(
            "Google Books HTTP %s attempt=%s has_key=%s body=%s",
            resp.status_code,
            attempt,
            bool(key),
            (resp.text or "")[:160],
        )
        last_err = GoogleBooksError(msg, status_code=resp.status_code)
        # 鉴权错误不必重试；503/429/5xx 可退避重试
        if resp.status_code in (401, 403) or resp.status_code not in _RETRYABLE_STATUS:
            raise last_err
        if attempt < _MAX_ATTEMPTS:
            await asyncio.sleep(0.6 * attempt)
            continue
        raise last_err

    raise last_err or GoogleBooksError("Google Books 请求失败")


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
    last_err: Optional[GoogleBooksError] = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(url, params=params)
        except httpx.TimeoutException as exc:
            last_err = GoogleBooksError("Google Books 详情请求超时")
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(0.4 * attempt)
                continue
            raise last_err from exc
        except httpx.HTTPError as exc:
            last_err = GoogleBooksError(f"Google Books 网络错误：{exc.__class__.__name__}")
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(0.4 * attempt)
                continue
            raise last_err from exc

        if resp.status_code == 404:
            return None
        if resp.status_code < 400:
            return _normalize(resp.json())
        last_err = GoogleBooksError(
            _friendly_http_error(resp.status_code, bool(key)), status_code=resp.status_code
        )
        if resp.status_code in (401, 403) or resp.status_code not in _RETRYABLE_STATUS:
            raise last_err
        if attempt < _MAX_ATTEMPTS:
            await asyncio.sleep(0.6 * attempt)
            continue
        raise last_err
    raise last_err or GoogleBooksError("Google Books 详情请求失败")


async def get_by_isbn(isbn: str, api_key: str = "") -> Optional[dict[str, Any]]:
    results = await search(query="", isbn=isbn, api_key=api_key, max_results=3)
    return results[0] if results else None


async def ping(api_key: str = "") -> dict[str, Any]:
    """管理页连通性自检：用轻量查询验证 Key/网络。"""
    key = resolve_api_key(api_key)
    try:
        hits = await search("python", api_key=key, max_results=1)
        return {
            "ok": True,
            "has_api_key": bool(key),
            "count": len(hits),
            "message": "Google Books 可访问" + ("（已使用 API Key）" if key else "（匿名配额，不稳定）"),
        }
    except GoogleBooksError as exc:
        return {
            "ok": False,
            "has_api_key": bool(key),
            "count": 0,
            "message": exc.message,
            "status_code": exc.status_code,
        }
