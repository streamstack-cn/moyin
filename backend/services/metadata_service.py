"""
metadata_service.py — 元数据聚合服务

策略：手动匹配时并行查询豆瓣 + Google Books；自动匹配优先豆瓣，失败再 Google。
Google Books 在无 API Key / 国内网络下常失败，失败信息需回传前端，且不可把「仅豆瓣」结果缓存成完整结果。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from models import AppConfig
from services import douban_service, google_books_service, redis_client
from services.google_books_service import GoogleBooksError

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "moyin:meta"
_SEARCH_TTL = 1800  # 候选列表缓存半小时
_MATCH_TTL = 86400


def _cache_key(*parts: str) -> str:
    raw = "|".join(parts)
    return f"{_CACHE_PREFIX}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def _cache_get(key: str) -> Any:
    client = redis_client.get_redis()
    if not client:
        return None
    try:
        raw = client.get(key)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


def _cache_set(key: str, value: Any, ttl: int) -> None:
    client = redis_client.get_redis()
    if not client:
        return
    try:
        client.setex(key, ttl, json.dumps(value, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        pass


def _get_config(db: Session, key: str, default: str = "") -> str:
    row = db.query(AppConfig).filter_by(key=key).first()
    return row.value if row else default


def _google_api_key(db: Session) -> str:
    return google_books_service.resolve_api_key(_get_config(db, "GOOGLE_BOOKS_API_KEY", ""))


def _with_proxied_covers(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """搜索候选的外链封面改走本站代理，避免豆瓣 CDN 防盗链导致裂图。"""
    from api_meta import proxied_cover_url

    out: list[dict[str, Any]] = []
    for item in results:
        row = dict(item)
        row["cover_url"] = proxied_cover_url(row.get("cover_url") or "")
        out.append(row)
    return out


async def _search_douban(query: str, cookie: str) -> tuple[list[dict[str, Any]], Optional[str]]:
    try:
        douban_hits = await douban_service.search_books(query, cookie)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Douban search failed: %s", exc)
        return [], f"豆瓣搜索失败：{exc.__class__.__name__}"

    results: list[dict[str, Any]] = []
    for hit in douban_hits[:15]:
        results.append(
            {
                "source": "douban",
                "douban_id": hit["douban_id"],
                "title": hit["title"],
                "subtitle": hit.get("sub_title", ""),
                "authors": hit.get("authors") or [],
                "translator": hit.get("translator") or "",
                "publisher": hit.get("publisher") or "",
                "cover_url": hit.get("cover_url", ""),
                "pub_date": hit.get("year", ""),
                "rating": hit.get("rating") or 0,
            }
        )
    return results, None


async def _search_google(query: str, api_key: str) -> tuple[list[dict[str, Any]], Optional[str]]:
    try:
        hits = await google_books_service.search(query, api_key=api_key, max_results=10)
        return hits[:8], None
    except GoogleBooksError as exc:
        logger.warning("Google Books search failed: %s", exc.message)
        return [], exc.message
    except Exception as exc:  # noqa: BLE001
        logger.warning("Google Books search unexpected error: %s", exc)
        return [], f"Google Books 搜索失败：{exc.__class__.__name__}"


async def search_candidates(db: Session, query: str) -> dict[str, Any]:
    """给手动匹配界面用：并行返回豆瓣 + Google Books，并附带各源状态。"""
    douban_enabled = _get_config(db, "DOUBAN_ENABLED", "false") == "true"
    cookie = _get_config(db, "DOUBAN_COOKIE", "")
    google_key = _google_api_key(db)
    has_google_key = bool(google_key)

    # v3：带分源状态；旧缓存结构不兼容
    cache_key = _cache_key(
        "search",
        "v3",
        query,
        str(douban_enabled),
        str(bool(cookie)),
        str(has_google_key),
    )
    cached = _cache_get(cache_key)
    if isinstance(cached, dict) and "results" in cached:
        payload = dict(cached)
        payload["results"] = _with_proxied_covers(payload.get("results") or [])
        return payload

    douban_task = None
    if douban_enabled and cookie:
        douban_task = asyncio.create_task(_search_douban(query, cookie))
    google_task = asyncio.create_task(_search_google(query, google_key))

    results: list[dict[str, Any]] = []
    sources: dict[str, Any] = {
        "douban": {"ok": False, "count": 0, "error": None, "enabled": douban_enabled and bool(cookie)},
        "google": {"ok": False, "count": 0, "error": None, "has_api_key": has_google_key},
    }

    if douban_task:
        douban_hits, douban_err = await douban_task
        results.extend(douban_hits)
        sources["douban"] = {
            "ok": douban_err is None,
            "count": len(douban_hits),
            "error": douban_err,
            "enabled": True,
        }
    else:
        sources["douban"]["error"] = "豆瓣未启用或未登录" if not douban_enabled else "豆瓣未配置 Cookie"

    google_hits, google_err = await google_task
    results.extend(google_hits)
    sources["google"] = {
        "ok": google_err is None,
        "count": len(google_hits),
        "error": google_err,
        "has_api_key": has_google_key,
    }

    payload = {"results": results, "sources": sources}

    # 仅当两边都成功（或一侧禁用且另一侧成功）时缓存，避免把 Google 限流结果锁半小时
    google_ok = sources["google"]["ok"]
    douban_ok_or_disabled = sources["douban"]["ok"] or not sources["douban"]["enabled"]
    if results and google_ok and douban_ok_or_disabled:
        _cache_set(cache_key, payload, _SEARCH_TTL)

    return {
        "results": _with_proxied_covers(results),
        "sources": sources,
    }


async def fetch_full_metadata(
    db: Session, source: str, source_id: str, query_hint: str = ""
) -> Optional[dict[str, Any]]:
    """按用户在候选列表里选中的条目，拉取完整详情"""
    if source == "douban":
        cookie = _get_config(db, "DOUBAN_COOKIE", "")
        return await douban_service.get_book_detail(source_id, cookie)
    if source == "google":
        api_key = _google_api_key(db)
        try:
            detail = await google_books_service.get_volume(source_id, api_key=api_key)
            if detail:
                return detail
        except GoogleBooksError as exc:
            logger.warning("Google Books get_volume failed: %s", exc.message)
        # 回退：按提示词再搜一次并匹配 ID
        try:
            hits = await google_books_service.search(query_hint or source_id, api_key=api_key)
            for hit in hits:
                if hit.get("google_books_id") == source_id:
                    return hit
            return hits[0] if hits else None
        except GoogleBooksError:
            return None
    return None


async def auto_match(db: Session, title: str, isbn: str = "") -> Optional[dict[str, Any]]:
    """导入新书时自动匹配：ISBN 精确优先，其次按书名模糊搜索取第一条"""
    douban_enabled = _get_config(db, "DOUBAN_ENABLED", "false") == "true"
    cookie = _get_config(db, "DOUBAN_COOKIE", "")
    google_key = _google_api_key(db)

    cache_key = _cache_key(
        "auto_match",
        "v2",
        title,
        isbn,
        str(douban_enabled),
        str(bool(cookie)),
        str(bool(google_key)),
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached or None

    result = await _auto_match_uncached(db, title, isbn, douban_enabled, cookie, google_key)
    _cache_set(cache_key, result, _MATCH_TTL)
    return result


async def _auto_match_uncached(
    db: Session,
    title: str,
    isbn: str,
    douban_enabled: bool,
    cookie: str,
    google_key: str,
) -> Optional[dict[str, Any]]:
    if douban_enabled and cookie:
        try:
            query = isbn or title
            result = await douban_service.search_and_fetch_best(query, cookie)
            if result:
                return result
        except Exception:  # noqa: BLE001
            pass

    try:
        if isbn:
            result = await google_books_service.get_by_isbn(isbn, api_key=google_key)
            if result:
                return result
        hits = await google_books_service.search(title, api_key=google_key)
        if hits:
            return hits[0]
    except GoogleBooksError as exc:
        logger.warning("Google Books auto_match failed: %s", exc.message)
    except Exception:  # noqa: BLE001
        pass

    return None
