"""
metadata_service.py — 元数据聚合服务

策略：手动匹配时并行查询豆瓣 + Google Books；自动匹配优先豆瓣，失败再 Google。
Google：与豆瓣并行；书本已有原作名/ISBN 时一并补搜（不套豆瓣打分，不等待豆瓣详情）。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from typing import Any, Optional

from sqlalchemy.orm import Session

from models import AppConfig
from services import douban_service, google_books_service, redis_client
from services.google_books_service import GoogleBooksError

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "moyin:meta"
_SEARCH_TTL = 1800  # 候选列表缓存半小时
_MATCH_TTL = 86400
_LATIN_RE = re.compile(r"[A-Za-z]")


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


def _douban_hit_row(hit: dict[str, Any]) -> dict[str, Any]:
    return {
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


def _usable_original_title(original_title: str, raw_query: str) -> str:
    """原作名需与原文不同，且含拉丁字母（多为英文原名），才值得再搜 Google。"""
    ot = (original_title or "").strip()
    rq = (raw_query or "").strip()
    if not ot or ot == rq:
        return ""
    if not _LATIN_RE.search(ot):
        return ""
    return ot


def _normalize_isbn(isbn: str) -> str:
    return re.sub(r"[^0-9Xx]", "", (isbn or "").strip())


def _merge_google_hits(
    *groups: list[dict[str, Any]],
    limit: int = 8,
) -> list[dict[str, Any]]:
    """按组优先级合并：先出现的组优先；组内保持 API 顺序；按 google_books_id 去重。

    ISBN 首条常无封面、后面文本结果有封面：合并后再按 ISBN / 书名回填封面。
    """
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    for group in groups:
        for hit in group or []:
            row = dict(hit)
            gid = (row.get("google_books_id") or "").strip()
            key = gid or f"title:{(row.get('title') or '').strip()}"
            if key in seen:
                existing = by_key.get(key)
                if existing and not existing.get("cover_url") and row.get("cover_url"):
                    existing["cover_url"] = row["cover_url"]
                continue
            seen.add(key)
            by_key[key] = row
            out.append(row)
            if len(out) >= limit:
                break
        if len(out) >= limit:
            break

    cover_by_isbn: dict[str, str] = {}
    cover_by_title: dict[str, str] = {}
    for hit in out:
        cover = (hit.get("cover_url") or "").strip()
        if not cover:
            continue
        isbn = _normalize_isbn(str(hit.get("isbn") or ""))
        if isbn:
            cover_by_isbn.setdefault(isbn, cover)
        title = (hit.get("title") or "").strip().lower()
        if title:
            cover_by_title.setdefault(title, cover)

    for hit in out:
        if (hit.get("cover_url") or "").strip():
            continue
        isbn = _normalize_isbn(str(hit.get("isbn") or ""))
        if isbn and isbn in cover_by_isbn:
            hit["cover_url"] = cover_by_isbn[isbn]
            continue
        title = (hit.get("title") or "").strip().lower()
        if title and title in cover_by_title:
            hit["cover_url"] = cover_by_title[title]

    return out


async def _search_douban_once(query: str, cookie: str) -> tuple[list[dict[str, Any]], Optional[str]]:
    try:
        # 手动匹配：搜索页+联想合并，拿到更多备选（无预热）
        douban_hits = await douban_service.search_books(query, cookie, fast=True)
    except douban_service.DoubanRiskControlError as exc:
        logger.warning("Douban risk control: %s", exc)
        return [], str(exc) or "豆瓣触发风控，请更新 Cookie 后重试"
    except Exception as exc:  # noqa: BLE001
        logger.warning("Douban search failed: %s", exc)
        return [], f"豆瓣搜索失败：{exc.__class__.__name__}"
    return [_douban_hit_row(h) for h in (douban_hits or [])[:24]], None


async def _search_google(query: str, api_key: str) -> tuple[list[dict[str, Any]], Optional[str]]:
    """单次 Google 搜索：原样返回 API 顺序。不清洗、不打分、不重排。"""
    q = (query or "").strip()
    if not q:
        return [], None
    try:
        hits = await google_books_service.search(query=q, api_key=api_key, max_results=10)
        return list(hits or [])[:8], None
    except GoogleBooksError as exc:
        logger.warning("Google Books search failed: %s", exc.message)
        return [], exc.message
    except Exception as exc:  # noqa: BLE001
        logger.warning("Google Books search unexpected error: %s", exc)
        return [], f"Google Books 搜索失败：{exc.__class__.__name__}"


async def _search_google_isbn(isbn: str, api_key: str) -> tuple[list[dict[str, Any]], Optional[str]]:
    clean = _normalize_isbn(isbn)
    if not clean:
        return [], None
    try:
        hits = await google_books_service.search(query="", isbn=clean, api_key=api_key, max_results=5)
        return list(hits or [])[:5], None
    except GoogleBooksError as exc:
        logger.warning("Google Books ISBN search failed: %s", exc.message)
        return [], exc.message
    except Exception as exc:  # noqa: BLE001
        logger.warning("Google Books ISBN search unexpected error: %s", exc)
        return [], f"Google Books 搜索失败：{exc.__class__.__name__}"


async def _search_google_enriched(
    *,
    raw_query: str,
    original_title: str,
    isbn: str,
    api_key: str,
) -> tuple[list[dict[str, Any]], Optional[str], str]:
    """
    Google 并行：原文 + 原作名 + ISBN，按 ISBN → 原作名 → 原文 合并。
    返回 (合并结果, 错误信息, 实际查询描述)。
    """
    ot = _usable_original_title(original_title, raw_query)
    clean_isbn = _normalize_isbn(isbn)

    tasks: dict[str, asyncio.Task] = {}
    if raw_query:
        tasks["raw"] = asyncio.create_task(_search_google(raw_query, api_key))
    if ot:
        tasks["orig"] = asyncio.create_task(_search_google(ot, api_key))
    if clean_isbn:
        tasks["isbn"] = asyncio.create_task(_search_google_isbn(clean_isbn, api_key))

    raw_hits: list[dict[str, Any]] = []
    orig_hits: list[dict[str, Any]] = []
    isbn_hits: list[dict[str, Any]] = []
    errors: list[str] = []

    if tasks:
        gathered = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for name, res in zip(tasks.keys(), gathered):
            if isinstance(res, Exception):
                errors.append(str(res))
                continue
            hits, err = res
            if err:
                errors.append(err)
            if name == "raw":
                raw_hits = hits
            elif name == "orig":
                orig_hits = hits
            elif name == "isbn":
                isbn_hits = hits

    merged = _merge_google_hits(isbn_hits, orig_hits, raw_hits, limit=8)
    query_parts = [p for p in [raw_query, ot, f"isbn:{clean_isbn}" if clean_isbn else ""] if p]
    google_query_label = " | ".join(query_parts) if query_parts else raw_query
    google_err: Optional[str] = errors[0] if (not merged and errors) else None
    return merged, google_err, google_query_label


async def search_candidates(
    db: Session,
    query: str,
    *,
    year: str = "",
    publisher: str = "",
    original_title: str = "",
    isbn: str = "",
) -> dict[str, Any]:
    """手动匹配：豆瓣可清洗+打分；Google 原文/原作名/ISBN 并行，不套豆瓣打分。"""
    from services.book_match import parse_book_title, rank_candidates

    douban_enabled = _get_config(db, "DOUBAN_ENABLED", "false") == "true"
    cookie = _get_config(db, "DOUBAN_COOKIE", "")
    google_key = _google_api_key(db)
    has_google_key = bool(google_key)

    raw_query = (query or "").strip()
    book_original = (original_title or "").strip()
    book_isbn = (isbn or "").strip()

    # ── 豆瓣：清洗书名 + 本地打分（与 Google 无关）──
    parsed = parse_book_title(raw_query, year_hint=year, publisher_hint=publisher)
    douban_query = (parsed.queries[0] if parsed.queries else raw_query).strip() or raw_query
    match_year = year or parsed.year
    match_publisher = publisher
    match_authors = list(parsed.authors or [])

    # v18：Google 封面回填（ISBN 首条无 imageLinks 时用 volumeId / 同 ISBN 封面）
    cache_key = _cache_key(
        "search",
        "v18",
        douban_query,
        raw_query,
        book_original,
        book_isbn,
        "|".join(match_authors),
        match_year,
        match_publisher,
        str(douban_enabled),
        str(bool(cookie)),
        str(has_google_key),
    )
    cached = _cache_get(cache_key)
    if isinstance(cached, dict) and "results" in cached:
        payload = dict(cached)
        payload["results"] = _with_proxied_covers(payload.get("results") or [])
        return payload

    douban_hits: list[dict[str, Any]] = []
    sources: dict[str, Any] = {
        "douban": {"ok": False, "count": 0, "error": None, "enabled": douban_enabled and bool(cookie)},
        "google": {"ok": False, "count": 0, "error": None, "has_api_key": has_google_key},
    }

    google_ot = _usable_original_title(book_original, raw_query)

    douban_task = (
        asyncio.create_task(_search_douban_once(douban_query, cookie))
        if douban_enabled and cookie
        else None
    )
    google_task = asyncio.create_task(
        _search_google_enriched(
            raw_query=raw_query,
            original_title=google_ot,
            isbn=book_isbn,
            api_key=google_key,
        )
    )

    if douban_task:
        douban_hits, douban_err = await douban_task
        sources["douban"] = {
            "ok": douban_err is None,
            "count": len(douban_hits),
            "error": douban_err,
            "enabled": True,
        }
    else:
        sources["douban"]["error"] = "豆瓣未启用或未登录" if not douban_enabled else "豆瓣未配置 Cookie"

    ranked_douban = rank_candidates(
        douban_hits,
        title=parsed.title or raw_query,
        year=match_year,
        publisher=match_publisher,
        authors=match_authors,
    )

    google_hits, google_err, google_query_label = await google_task

    sources["google"] = {
        "ok": google_err is None,
        "count": len(google_hits),
        "error": google_err,
        "has_api_key": has_google_key,
    }

    results = ranked_douban + list(google_hits)

    payload = {
        "results": results,
        "sources": sources,
        "parsed_title": parsed.title,
        "parsed_authors": match_authors,
        "search_query": douban_query,
        "google_query": google_query_label,
        "google_ranking": "api",
    }

    google_ok = sources["google"]["ok"]
    douban_ok_or_disabled = sources["douban"]["ok"] or not sources["douban"]["enabled"]
    if results and google_ok and douban_ok_or_disabled:
        _cache_set(cache_key, payload, _SEARCH_TTL)

    return {
        "results": _with_proxied_covers(results),
        "sources": sources,
        "parsed_title": parsed.title,
        "parsed_authors": match_authors,
        "search_query": douban_query,
        "google_query": google_query_label,
        "google_ranking": "api",
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


async def auto_match(
    db: Session,
    title: str,
    isbn: str = "",
    *,
    year: str = "",
    publisher: str = "",
    original_title: str = "",
) -> Optional[dict[str, Any]]:
    """导入新书时自动匹配：ISBN 优先；否则清洗书名并用年/出版社打分挑选。"""
    from services.book_match import parse_book_title

    douban_enabled = _get_config(db, "DOUBAN_ENABLED", "false") == "true"
    cookie = _get_config(db, "DOUBAN_COOKIE", "")
    google_key = _google_api_key(db)
    parsed = parse_book_title(title, year_hint=year, publisher_hint=publisher)
    book_original = (original_title or "").strip()

    cache_key = _cache_key(
        "auto_match",
        "v8",
        title or "",
        book_original,
        "|".join(parsed.authors or []),
        isbn,
        parsed.year or year,
        publisher,
        str(douban_enabled),
        str(bool(cookie)),
        str(bool(google_key)),
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached or None

    result = await _auto_match_uncached(
        db,
        title=title,
        isbn=isbn,
        year=year or parsed.year,
        publisher=publisher,
        parsed_title=parsed.title,
        parsed_authors=list(parsed.authors or []),
        original_title=book_original,
        douban_enabled=douban_enabled,
        cookie=cookie,
        google_key=google_key,
    )
    _cache_set(cache_key, result, _MATCH_TTL)
    return result


async def _auto_match_uncached(
    db: Session,
    title: str,
    isbn: str,
    year: str,
    publisher: str,
    parsed_title: str,
    parsed_authors: list[str],
    original_title: str,
    douban_enabled: bool,
    cookie: str,
    google_key: str,
) -> Optional[dict[str, Any]]:
    douban_blocked: Optional[douban_service.DoubanRiskControlError] = None
    if douban_enabled and cookie:
        try:
            if isbn:
                result = await douban_service.search_and_fetch_best(
                    isbn, cookie, year=year, publisher=publisher
                )
                if result:
                    return result
            result = await douban_service.search_and_fetch_best(
                title, cookie, year=year, publisher=publisher
            )
            if result:
                return result
        except douban_service.DoubanRiskControlError as exc:
            douban_blocked = exc
            logger.warning("Douban auto_match blocked: %s", exc)
        except Exception:  # noqa: BLE001
            pass

    try:
        hits, _err, _label = await _search_google_enriched(
            raw_query=(title or "").strip(),
            original_title=original_title,
            isbn=isbn,
            api_key=google_key,
        )
        if hits:
            return hits[0]
    except GoogleBooksError as exc:
        logger.warning("Google Books auto_match failed: %s", exc.message)
    except Exception:  # noqa: BLE001
        pass

    # 豆瓣被风控且谷歌也无结果时，向上抛出以便前端提示更新 Cookie
    if douban_blocked:
        raise douban_blocked
    return None
