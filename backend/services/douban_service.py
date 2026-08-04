"""
douban_service.py — 豆瓣图书元数据抓取（登录态 Cookie 模式 + 扫码直接登录）

设计原则（沿用 streamstack 的豆瓣集成经验）：
- 不做账号密码模拟登录（容易触发验证码/风控，且需要在服务端保存明文密码）；
  优先提供和豆瓣官网一致的"扫码登录"，扫码不可用时保留手动粘贴 Cookie。
- 所有请求都带上 Cookie 与常规浏览器 UA，降低被限流概率；网络异常一律降级返回空结果。

字段说明：
- 豆瓣图书页 #info 通常含：作者/译者/出版社/出版年/页数/定价/装帧/ISBN/丛书/副标题/原作名
- 「出版地」不是豆瓣标准字段；本服务会按出版社名前缀做启发式推断（如「上海三联书店」→「上海」）
- 豆瓣近年已从公开 HTML 中移除「常用标签」区块，故 categories 可能为空（非抓取失败）
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import random
import re
import string
import time
import uuid
from typing import Any, Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

SUGGEST_URL = "https://book.douban.com/j/subject_suggest"
SEARCH_URL = "https://search.douban.com/book/subject_search"
SUBJECT_URL = "https://book.douban.com/subject/{id}/"
MINE_URL = "https://www.douban.com/mine/"
HOME_URL = "https://www.douban.com/"
BOOK_HOME_URL = "https://book.douban.com/"
QRCODE_CODE_URL = "https://accounts.douban.com/j/mobile/login/qrlogin_code"
QRCODE_STATUS_URL = "https://accounts.douban.com/j/mobile/login/qrlogin_status"
QRCODE_SESSION_TTL_SECONDS = 5 * 60

# 请求节流：批量匹配时降低触发 sec.douban.com 的概率
# 手动「匹配在线元数据」走 fast 路径，尽量只打 1 次请求
_MIN_REQUEST_INTERVAL = 0.35
_last_request_at = 0.0
_warmup_cookie_key = ""
_warmup_at = 0.0
_WARMUP_TTL = 10 * 60


class DoubanRiskControlError(Exception):
    """豆瓣风控 / PoW / 登录跳转。"""

    def __init__(self, message: str = "", *, final_url: str = ""):
        super().__init__(message or "豆瓣触发风控")
        self.final_url = final_url


def _gen_bid() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(random.choice(alphabet) for _ in range(11))


def sanitize_cookie_input(cookie: str = "") -> str:
    """清理用户粘贴的 Cookie：去掉 Cookie: 前缀、换行与多余空白。"""
    s = (cookie or "").strip()
    s = re.sub(r"(?i)^cookie\s*:\s*", "", s)
    s = s.replace("\r", "\n")
    # 有人会竖着粘贴多行 name=value
    if "\n" in s and ";" not in s:
        parts = [ln.strip().strip(",") for ln in s.split("\n") if ln.strip()]
        s = "; ".join(parts)
    else:
        s = re.sub(r"[\n\t]+", " ", s)
    s = re.sub(r"\s*;\s*", "; ", s)
    s = re.sub(r"\s{2,}", " ", s).strip().strip(";")
    return s


def _normalize_cookie(cookie: str = "") -> str:
    """保证带有 bid；补齐常见浏览器痕迹字段（不覆盖用户已有值）。"""
    raw = sanitize_cookie_input(cookie)
    parts: dict[str, str] = {}
    if raw:
        for seg in raw.split(";"):
            seg = seg.strip()
            if not seg or "=" not in seg:
                continue
            k, v = seg.split("=", 1)
            key = k.strip()
            # 防止把「Cookie: bid」之类脏键写进去
            if not key or key.lower() == "cookie" or any(ch in key for ch in (" ", "\n", "\t")):
                continue
            parts[key] = v.strip()
    if "bid" not in parts:
        parts["bid"] = _gen_bid()
    # ll 为地区偏好，缺省时补一个常见值，降低异常画像
    if "ll" not in parts:
        parts["ll"] = '"108288"'
    # 保持用户原有顺序：先原 cookie，再补缺省
    ordered: list[str] = []
    seen: set[str] = set()
    if raw:
        for seg in raw.split(";"):
            seg = seg.strip()
            if not seg or "=" not in seg:
                continue
            k = seg.split("=", 1)[0].strip()
            if k not in parts or k in seen:
                continue
            seen.add(k)
            ordered.append(f"{k}={parts[k]}")
    for k, v in parts.items():
        if k in seen:
            continue
        ordered.append(f"{k}={v}")
    return "; ".join(ordered)


def prepare_cookie(cookie: str = "") -> str:
    """对外：清洗并规范化用户粘贴的 Cookie。"""
    return _normalize_cookie(sanitize_cookie_input(cookie))


def _cookie_has_login_token(cookie: str) -> bool:
    return bool(re.search(r"(?:^|;\s*)dbcl2=", cookie or "", re.I))


def cookie_has_login_token(cookie: str = "") -> bool:
    """对外：判断 Cookie 是否含登录凭证 dbcl2。"""
    return _cookie_has_login_token(prepare_cookie(cookie) or sanitize_cookie_input(cookie))


def _probe_headers(cookie: str) -> dict:
    """探活用更保守的请求头，避免过度「浏览器伪装」反而触发拦截。"""
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cookie": _normalize_cookie(cookie),
        "Referer": "https://www.douban.com/",
    }


def _is_risk_control(resp: httpx.Response) -> bool:
    final = str(resp.url)
    if "sec.douban.com" in final or "/sec/captcha" in final or "/misc/sorry" in final:
        return True
    if resp.status_code in (401, 403):
        return True
    text = resp.text or ""
    if len(text) < 5000 and re.search(r"captchaToken|verifyToken|window\.captcha", text):
        return True
    title_m = re.search(r"<title>([^<]+)</title>", text[:2000], re.I)
    if title_m:
        t = title_m.group(1)
        if any(x in t for x in ("登录跳转", "验证", "禁止访问", "sec")):
            return True
    return False

# 出版社名若以这些城市开头，可推断出版地（豆瓣本身不提供出版地字段）
_CITY_PREFIXES = (
    "北京", "上海", "天津", "重庆", "南京", "杭州", "武汉", "广州", "成都", "西安",
    "长沙", "济南", "沈阳", "哈尔滨", "长春", "郑州", "福州", "合肥", "南昌", "昆明",
    "南宁", "贵阳", "兰州", "石家庄", "太原", "呼和浩特", "乌鲁木齐", "银川", "西宁",
    "海口", "拉萨", "香港", "台北", "澳门", "深圳", "苏州", "无锡", "青岛", "大连",
    "宁波", "厦门",
)

# 常见无城市前缀的出版社 → 出版地
_PUBLISHER_PLACE = {
    "商务印书馆": "北京",
    "中华书局": "北京",
    "人民出版社": "北京",
    "人民文学出版社": "北京",
    "作家出版社": "北京",
    "生活·读书·新知三联书店": "北京",
    "三联书店": "北京",
    "科学出版社": "北京",
    "高等教育出版社": "北京",
    "北京大学出版社": "北京",
    "清华大学出版社": "北京",
    "中国社会科学出版社": "北京",
    "社会科学文献出版社": "北京",
    "中信出版社": "北京",
    "机械工业出版社": "北京",
    "电子工业出版社": "北京",
    "译林出版社": "南京",
    "江苏人民出版社": "南京",
    "浙江人民出版社": "杭州",
    "广西师范大学出版社": "桂林",
    "复旦大学出版社": "上海",
    "华东师范大学出版社": "上海",
    "上海人民出版社": "上海",
    "上海古籍出版社": "上海",
    "上海译文出版社": "上海",
    "Yale University Press": "New Haven",
    "Oxford University Press": "Oxford",
    "Cambridge University Press": "Cambridge",
    "Harvard University Press": "Cambridge",
    "Princeton University Press": "Princeton",
    "IVP": "Downers Grove",
    "InterVarsity Press": "Downers Grove",
    "Eerdmans": "Grand Rapids",
    "Wm. B. Eerdmans": "Grand Rapids",
    "Baker Academic": "Grand Rapids",
    "Zondervan": "Grand Rapids",
    "Crossway": "Wheaton",
}


def _headers(
    cookie: str = "",
    referer: str = "https://book.douban.com/",
    *,
    xhr: bool = False,
) -> dict:
    """尽量贴近真实 Chrome 导航/XHR，降低被 sec.douban 拦截的概率。"""
    cookie = _normalize_cookie(cookie)
    if xhr:
        accept = "application/json, text/plain, */*"
        dest, mode, site = "empty", "cors", "same-site"
    else:
        accept = (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8"
        )
        dest, mode, site = "document", "navigate", "same-site" if referer else "none"
    headers = {
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "max-age=0",
        "Cookie": cookie,
        "Sec-Ch-Ua": '"Chromium";v="126", "Not.A/Brand";v="8", "Google Chrome";v="126"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": dest,
        "Sec-Fetch-Mode": mode,
        "Sec-Fetch-Site": site,
        "Upgrade-Insecure-Requests": "1",
    }
    if referer:
        headers["Referer"] = referer
    if xhr:
        headers["X-Requested-With"] = "XMLHttpRequest"
        headers.pop("Upgrade-Insecure-Requests", None)
    return headers


async def _throttle() -> None:
    global _last_request_at
    now = time.monotonic()
    wait = _MIN_REQUEST_INTERVAL - (now - _last_request_at)
    if wait > 0:
        await asyncio.sleep(wait + random.uniform(0.02, 0.12))
    _last_request_at = time.monotonic()


async def _maybe_warmup(client: httpx.AsyncClient, cookie: str) -> None:
    """同 Cookie 一段时间内先访问首页，建立会话痕迹。"""
    global _warmup_cookie_key, _warmup_at
    key = cookie[:120]
    now = time.monotonic()
    if _warmup_cookie_key == key and now - _warmup_at < _WARMUP_TTL:
        return
    try:
        await client.get(HOME_URL, headers=_headers(cookie, referer="", xhr=False))
        await asyncio.sleep(random.uniform(0.25, 0.55))
        await client.get(
            BOOK_HOME_URL,
            headers=_headers(cookie, referer="https://www.douban.com/"),
        )
    except Exception:  # noqa: BLE001
        pass
    _warmup_cookie_key = key
    _warmup_at = time.monotonic()


async def _douban_get(
    url: str,
    *,
    cookie: str = "",
    params: Optional[dict] = None,
    referer: str = "https://book.douban.com/",
    xhr: bool = False,
    timeout: float = 15,
    warmup: bool = True,
) -> httpx.Response:
    await _throttle()
    cookie = _normalize_cookie(cookie)
    headers = _headers(cookie, referer=referer, xhr=xhr)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        if warmup:
            await _maybe_warmup(client, cookie)
            await _throttle()
        resp = await client.get(url, params=params, headers=headers)
    if _is_risk_control(resp):
        logger.warning("Douban risk control at %s -> %s", url, resp.url)
        raise DoubanRiskControlError(
            "豆瓣触发风控（sec.douban.com）。请到管理后台重新扫码/粘贴 Cookie 后重试，并降低批量匹配频率。",
            final_url=str(resp.url),
        )
    resp.raise_for_status()
    return resp


def infer_pub_place(publisher: str) -> str:
    """豆瓣无出版地字段时，从出版社名启发式推断。"""
    pub = (publisher or "").strip()
    if not pub:
        return ""
    for city in _CITY_PREFIXES:
        if pub.startswith(city):
            return city
    for name, place in _PUBLISHER_PLACE.items():
        if name in pub:
            return place
    return ""


def parse_douban_display_name(html: str, user_id: str = "") -> str:
    """从个人主页 HTML 解析展示昵称（避免把 title/签名误当成 nickname）。"""
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        return user_id or ""

    h1 = (
        soup.select_one("#db-usr-profile .info h1")
        or soup.select_one("#content .info h1")
        or soup.select_one(".user-info .info h1")
        or soup.select_one(".info h1")
    )
    if h1:
        for el in h1.select("#edit-signature, .signature, .pl, span, a, div, img"):
            el.decompose()
        raw = re.sub(r"\s+", " ", h1.get_text(" ", strip=True)).strip()
        raw = re.sub(r"的(豆瓣|主页|小站)$", "", raw).strip()
        if raw and raw not in ("登录豆瓣", "豆瓣", "豆瓣读书"):
            return raw

    title = soup.select_one("title")
    if title:
        t = title.get_text(strip=True)
        t = re.sub(r"的豆瓣.*$", "", t).strip()
        t = re.split(r"[|｜\-–—]", t, maxsplit=1)[0].strip()
        t = re.sub(r"\s+", " ", t).strip()
        if t and t not in ("登录豆瓣", "豆瓣", "豆瓣读书"):
            return t
    return user_id or ""


async def check_cookie(cookie: str) -> dict[str, Any]:
    """探活 Cookie：访问 /mine/，登录态会 302 到 /people/<id>/。

    与搜索请求分离：不走预热/强风控抛错，避免把「IP 被风控」误报成「Cookie 无效」。
    """
    raw = sanitize_cookie_input(cookie)
    if not raw:
        return {
            "valid": False,
            "user_id": "",
            "name": "",
            "error": "请粘贴豆瓣 Cookie",
        }
    normalized = _normalize_cookie(raw)
    if not _cookie_has_login_token(normalized):
        return {
            "valid": False,
            "user_id": "",
            "name": "",
            "error": "Cookie 中缺少 dbcl2（登录凭证）。请在已登录豆瓣的浏览器中打开任意页面，从请求头复制完整 Cookie，需包含 dbcl2 与 ck。",
        }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(MINE_URL, headers=_probe_headers(normalized))
    except Exception as exc:  # noqa: BLE001
        return {
            "valid": False,
            "user_id": "",
            "name": "",
            "error": f"无法连接豆瓣：{exc.__class__.__name__}",
        }

    final = str(resp.url)
    # 风控：Cookie 本身可能仍有效
    if "sec.douban.com" in final or "/misc/sorry" in final or "/sec/captcha" in final:
        return {
            "valid": False,
            "user_id": "",
            "name": "",
            "risk_control": True,
            "error": "豆瓣对当前服务器 IP 触发了访问风控（Cookie 可能仍有效）。已可先保存，系统会定时复检。",
        }

    match = re.search(r"/people/([^/]+)/", final)
    if match:
        user_id = match.group(1)
        name = parse_douban_display_name(resp.text, user_id)
        return {"valid": True, "user_id": user_id, "name": name}

    if "accounts.douban.com" in final or "passport/login" in final or "login" in final.lower():
        return {
            "valid": False,
            "user_id": "",
            "name": "",
            "error": "Cookie 无效或已过期。请重新登录豆瓣后，再复制包含 dbcl2、ck、bid 的完整 Cookie。",
        }

    # 少数情况：仍停在 /mine/ 但未跳到 people
    if resp.status_code == 200 and ("logout" in resp.text.lower() or "我的豆瓣" in resp.text):
        # 尝试从页面再解析 people 链接
        m2 = re.search(r"/people/([^/]+)/", resp.text or "")
        if m2:
            user_id = m2.group(1)
            name = parse_douban_display_name(resp.text, user_id)
            return {"valid": True, "user_id": user_id, "name": name}

    return {
        "valid": False,
        "user_id": "",
        "name": "",
        "error": f"未能确认登录态（最终地址：{final[:80]}）。请确认复制的是登录后的完整 Cookie。",
    }


def _extract_window_data(html: str) -> dict[str, Any]:
    """解析 search.douban.com 页面里的 window.__DATA__ = {...}"""
    marker = "window.__DATA__"
    idx = html.find(marker)
    if idx < 0:
        return {}
    eq = html.find("=", idx)
    if eq < 0:
        return {}
    try:
        data, _ = json.JSONDecoder().raw_decode(html[eq + 1 :].lstrip())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _parse_search_abstract(abstract: str) -> dict[str, Any]:
    """
    解析豆瓣搜索摘要，常见形态：
    「作者 / 译者 / 出版社 / 出版年 / 定价」或「作者 / 出版社 / 出版年」
    """
    parts = [p.strip() for p in (abstract or "").split(" / ") if p.strip()]
    price = ""
    year = ""
    publisher = ""
    # 定价：含货币符号，或纯数字（如 86.00）
    if parts and (
        re.search(r"(元|NT\$|TWD|CNY|￥|\$)", parts[-1], re.I)
        or re.fullmatch(r"\d+(\.\d+)?", parts[-1])
    ):
        price = parts.pop()
    # 「2019-10 86.00」偶发粘在同一段
    if parts and re.match(r"^(\d{4}(?:[-./]\d{1,2}){0,2})\s+(\d+(?:\.\d+)?)$", parts[-1]):
        m = re.match(r"^(\d{4}(?:[-./]\d{1,2}){0,2})\s+(\d+(?:\.\d+)?)$", parts[-1])
        assert m
        year = m.group(1)
        price = price or m.group(2)
        parts.pop()
    elif parts and re.match(r"^\d{4}", parts[-1]):
        year = parts.pop()
    if parts:
        publisher = parts.pop()
    authors = [parts[0]] if parts else []
    translator = " / ".join(parts[1:]) if len(parts) > 1 else ""
    return {
        "authors": authors,
        "translator": translator,
        "publisher": publisher,
        "year": year,
        "price": price,
    }


def _merge_book_hits(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按 douban_id 去重合并；先出现的优先（搜索页版本信息更全）。"""
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        for hit in group or []:
            sid = str(hit.get("douban_id") or "").strip()
            if not sid or sid in seen:
                continue
            seen.add(sid)
            merged.append(hit)
    return merged


async def search_books(
    query: str,
    cookie: str = "",
    *,
    fast: bool = False,
) -> list[dict[str, Any]]:
    """
    图书搜索。
    - fast=True（手动匹配）：搜索页（无预热）+ 联想合并，尽量多备选且不拖太久
    - fast=False（自动匹配等）：搜索页优先（含预热），不足再补联想
    """
    q = (query or "").strip()
    if not q:
        return []

    risk_err: Optional[DoubanRiskControlError] = None
    subject_hits: list[dict[str, Any]] = []
    suggest_hits: list[dict[str, Any]] = []

    if fast:
        # 手动匹配：跳过预热；两路都打，合并去重拿更多版本/相关书
        try:
            subject_hits = await _search_books_via_subject_search(q, cookie, warmup=False)
        except DoubanRiskControlError as exc:
            risk_err = exc
        try:
            suggest_hits = await _search_books_via_suggest(q, cookie)
        except DoubanRiskControlError as exc:
            risk_err = risk_err or exc
        merged = _merge_book_hits(subject_hits, suggest_hits)
        if merged:
            return merged
        if risk_err:
            raise risk_err
        return []

    try:
        subject_hits = await _search_books_via_subject_search(q, cookie, warmup=True)
    except DoubanRiskControlError as exc:
        risk_err = exc

    if len(subject_hits) < 8:
        try:
            suggest_hits = await _search_books_via_suggest(q, cookie)
        except DoubanRiskControlError as exc:
            risk_err = risk_err or exc

    merged = _merge_book_hits(subject_hits, suggest_hits)
    if merged:
        return merged
    if risk_err:
        raise risk_err
    return []


async def _search_books_via_subject_search(
    query: str, cookie: str = "", *, warmup: bool = True
) -> list[dict[str, Any]]:
    resp = await _douban_get(
        SEARCH_URL,
        cookie=cookie,
        params={"search_text": query, "cat": "1001"},
        referer="https://book.douban.com/",
        timeout=15,
        warmup=warmup,
    )
    data = _extract_window_data(resp.text)
    if not data:
        # 无 __DATA__ 时也可能是软风控 / 页面改版
        if _is_risk_control(resp) or "subject_search" not in resp.text[:3000]:
            if "sec.douban" in str(resp.url) or len(resp.text) < 2000:
                raise DoubanRiskControlError(
                    "豆瓣搜索页无有效数据，可能已触发风控。请更新 Cookie 后重试。",
                    final_url=str(resp.url),
                )
        return []

    results: list[dict[str, Any]] = []
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        tpl = (item.get("tpl_name") or "").lower()
        if tpl and tpl != "search_subject":
            continue
        sid = item.get("id")
        if not sid:
            continue
        parsed = _parse_search_abstract(item.get("abstract") or "")
        rating_raw = item.get("rating") or {}
        try:
            rating = float(rating_raw.get("value") or 0) or 0.0
        except (TypeError, ValueError):
            rating = 0.0
        cover = item.get("cover_url") or ""
        if cover.startswith("//"):
            cover = "https:" + cover
        results.append(
            {
                "douban_id": str(sid),
                "title": item.get("title") or "",
                "sub_title": "",
                "authors": parsed["authors"],
                "translator": parsed["translator"],
                "publisher": parsed["publisher"],
                "cover_url": cover,
                "url": item.get("url") or f"https://book.douban.com/subject/{sid}/",
                "year": parsed["year"],
                "price": parsed["price"],
                "rating": rating,
            }
        )
    return results


async def _search_books_via_suggest(query: str, cookie: str = "") -> list[dict[str, Any]]:
    """联想接口兜底：速度快但版本少、字段少。"""
    resp = await _douban_get(
        SUGGEST_URL,
        cookie=cookie,
        params={"q": query},
        referer="https://book.douban.com/",
        xhr=True,
        timeout=12,
        warmup=False,
    )
    try:
        data = resp.json()
    except Exception:
        return []

    results = []
    for item in data if isinstance(data, list) else []:
        item_type = (item.get("type") or "").lower()
        if item_type not in ("book", "b", ""):
            continue
        results.append(
            {
                "douban_id": str(item.get("id", "")),
                "title": item.get("title", ""),
                "sub_title": item.get("sub_title", ""),
                "authors": [item["author_name"]] if item.get("author_name") else [],
                "translator": "",
                "publisher": "",
                "cover_url": item.get("pic", ""),
                "url": item.get("url", ""),
                "year": item.get("year", ""),
                "price": "",
                "rating": 0.0,
            }
        )
    return results


def _clean_person_names(raw: str) -> str:
    """整理作者/译者：去掉豆瓣 HTML 里夹带的空段与单独斜杠，得到「甲 / 乙」。"""
    if not raw:
        return ""
    parts = [p.strip() for p in re.split(r"[/／]", raw) if p.strip()]
    parts = [p for p in parts if not re.fullmatch(r"[:：·•\s]+", p)]
    # 去重保序
    seen: set[str] = set()
    uniq: list[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return " / ".join(uniq)


def _parse_info_block(info_tag) -> dict[str, str]:
    """解析豆瓣详情页 #info。作者等字段常被包在额外 <span> 里，不能只扫直接子节点。"""
    result: dict[str, str] = {}
    if info_tag is None:
        return result

    for pl in info_tag.select("span.pl"):
        key = pl.get_text(strip=True).rstrip(":：").strip()
        if not key:
            continue
        parts: list[str] = []
        for sib in pl.next_siblings:
            name = getattr(sib, "name", None)
            if name == "br":
                break
            if name == "span" and "pl" in (sib.get("class") or []):
                break
            if hasattr(sib, "get_text"):
                text = sib.get_text(" ", strip=True)
            else:
                text = str(sib).strip()
            # 豆瓣多人译者常在 <a> 之间插入纯文本「/」，空链接也会产出空串
            if text in ("", ":", "：", "/", "／"):
                continue
            if re.fullmatch(r"[/／\s]+", text):
                continue
            parts.append(text)
        if not parts and pl.parent is not None and pl.parent.name == "span" and pl.parent is not info_tag:
            full = pl.parent.get_text(" ", strip=True)
            val = re.sub(rf"^{re.escape(key)}\s*[:：]?\s*", "", full).strip()
            if val:
                parts = [val]
        if parts:
            joined = " / ".join(parts)
            # 作者/译者再按斜杠拆一次，去掉「郝明义 / / / 朱衣」这类空段
            if key in ("作者", "译者"):
                result[key] = _clean_person_names(joined)
            else:
                seen: set[str] = set()
                uniq: list[str] = []
                for p in parts:
                    if p not in seen:
                        seen.add(p)
                        uniq.append(p)
                result[key] = " / ".join(uniq)
    return result


def _extract_cover_url(soup: BeautifulSoup) -> str:
    """优先大图（#mainpic a[href]），再回退缩略图，并把 /s/ 升级为 /l/。"""
    cover_a = soup.select_one("#mainpic a")
    href = (cover_a.get("href") if cover_a else "") or ""
    if href.startswith("//"):
        href = "https:" + href
    if href.startswith("http") and any(href.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")):
        url = href
    else:
        cover_tag = soup.select_one("#mainpic img")
        url = ""
        if cover_tag:
            url = cover_tag.get("src") or cover_tag.get("data-src") or ""
            if url.startswith("//"):
                url = "https:" + url
    if not url:
        return ""
    # 小图升级为大图
    url = url.replace("/view/subject/s/", "/view/subject/l/")
    url = url.replace("/subject/s/public/", "/subject/l/public/")
    return url


def _extract_tags(soup: BeautifulSoup) -> list[str]:
    """豆瓣公开页近年常不再渲染标签区；有则抓，无则返回空。"""
    tags: list[str] = []
    for a in soup.select("#db-tags-section a, .tags-body a, a.tag"):
        name = a.get_text(strip=True)
        if name and name not in tags:
            tags.append(name)
    return tags[:12]


def _extract_catalog(soup: BeautifulSoup, douban_id: str) -> str:
    """抓取豆瓣「目录」。优先完整展开块 #dir_{id}_full，否则回退短目录。"""
    candidates = []
    if douban_id:
        candidates.extend(
            [
                soup.select_one(f"#dir_{douban_id}_full"),
                soup.select_one(f"#dir_{douban_id}"),
            ]
        )
    candidates.extend(soup.select("[id^=dir_][id$=_full]"))
    candidates.extend(soup.select("[id^=dir_]"))
    seen_ids: set[str] = set()
    for node in candidates:
        if node is None:
            continue
        nid = node.get("id") or ""
        if nid in seen_ids:
            continue
        seen_ids.add(nid)
        # 复制节点，把 <br> 换成换行，去掉「(收起)/(更多)」类链接文案
        clone = BeautifulSoup(str(node), "lxml")
        root = clone.body or clone
        for a in root.select("a"):
            t = a.get_text(strip=True)
            if t in ("(收起)", "（收起）", "(更多)", "（更多）", "· · · · · ·"):
                a.decompose()
        for br in root.find_all("br"):
            br.replace_with("\n")
        text = root.get_text("\n", strip=True)
        # 去掉开头可能残留的「目录」标题行
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if lines and re.fullmatch(r"目录", lines[0]):
            lines = lines[1:]
        cleaned = "\n".join(lines).strip()
        if cleaned:
            return cleaned
    return ""


async def get_book_detail(douban_id: str, cookie: str = "") -> Optional[dict[str, Any]]:
    url = SUBJECT_URL.format(id=douban_id)
    try:
        resp = await _douban_get(
            url,
            cookie=cookie,
            referer="https://book.douban.com/",
            timeout=15,
            warmup=True,
        )
    except DoubanRiskControlError:
        raise
    except Exception:
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    title_tag = soup.select_one("#wrapper h1 span") or soup.select_one("#wrapper h1")
    title = title_tag.get_text(strip=True) if title_tag else ""

    info_tag = soup.select_one("#info")
    info = _parse_info_block(info_tag) if info_tag else {}

    rating_tag = soup.select_one("strong.rating_num, .rating_num")
    rating = 0.0
    if rating_tag and rating_tag.get_text(strip=True):
        try:
            rating = float(rating_tag.get_text(strip=True))
        except ValueError:
            rating = 0.0

    desc_tag = soup.select_one("#link-report .intro") or soup.select_one("#link-report span.all.hidden") or soup.select_one("#link-report")
    description = desc_tag.get_text("\n", strip=True) if desc_tag else ""

    cover_url = _extract_cover_url(soup)
    categories = _extract_tags(soup)
    catalog = _extract_catalog(soup, douban_id)

    authors_raw = _clean_person_names(info.get("作者", ""))
    authors = [a.strip() for a in re.split(r"[/／]", authors_raw) if a.strip()]
    translator = _clean_person_names(info.get("译者", ""))

    isbn = info.get("ISBN", "").strip()
    page_count = 0
    try:
        page_count = int(re.sub(r"\D", "", info.get("页数", "0") or "0") or 0)
    except ValueError:
        page_count = 0

    publisher = info.get("出版社", "")
    pub_place = infer_pub_place(publisher)

    return {
        "source": "douban",
        "douban_id": douban_id,
        "title": title,
        "subtitle": info.get("副标题", ""),
        "original_title": info.get("原作名", ""),
        "authors": authors,
        "translator": translator,
        "publisher": publisher,
        "pub_place": pub_place,
        "pub_date": info.get("出版年", ""),
        "isbn": isbn,
        "series": info.get("丛书", ""),
        "page_count": page_count,
        "language": "zh",
        "description": description,
        "catalog": catalog,
        "cover_url": cover_url,
        "rating": rating,
        "categories": categories,
        "binding": info.get("装帧", ""),
        "price": info.get("定价", ""),
        "producer": info.get("出品方", ""),
    }


async def search_and_fetch_best(
    query: str,
    cookie: str = "",
    *,
    year: str = "",
    publisher: str = "",
) -> Optional[dict[str, Any]]:
    """清洗书名后搜索，按标题/年份/出版社打分取最佳，再抓详情。"""
    from services.book_match import parse_book_title, pick_best_candidate, rank_candidates

    parsed = parse_book_title(query, year_hint=year, publisher_hint=publisher)
    match_title = parsed.title or query
    match_year = year or parsed.year
    match_publisher = publisher
    match_authors = list(parsed.authors or [])

    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    risk_err: Optional[DoubanRiskControlError] = None
    for q in parsed.queries[:3]:
        try:
            hits = await search_books(q, cookie)
        except DoubanRiskControlError as exc:
            risk_err = exc
            break
        for hit in hits:
            sid = str(hit.get("douban_id") or "")
            if not sid or sid in seen_ids:
                continue
            seen_ids.add(sid)
            merged.append(hit)
        # 已有高置信候选时可早停，减少请求、降低风控
        if merged:
            ranked = rank_candidates(
                merged,
                title=match_title,
                year=match_year,
                publisher=match_publisher,
                authors=match_authors,
            )
            if ranked and float(ranked[0].get("_match_score") or 0) >= 85:
                merged = ranked
                break

    if not merged:
        if risk_err:
            raise risk_err
        return None

    best = pick_best_candidate(
        merged,
        title=match_title,
        year=match_year,
        publisher=match_publisher,
        authors=match_authors,
        min_score=58.0,
    )
    if not best:
        return None

    detail = await get_book_detail(str(best["douban_id"]), cookie)
    if detail and not detail.get("cover_url"):
        detail["cover_url"] = best.get("cover_url", "")
    if detail:
        detail["_match_score"] = best.get("_match_score")
        detail["_match_query"] = match_title
    return detail


# ── 扫码直接登录 ──────────────────────────────────────────────────────────

class _QRSession:
    __slots__ = ("client", "code", "created_at")

    def __init__(self, client: httpx.AsyncClient, code: str):
        self.client = client
        self.code = code
        self.created_at = time.monotonic()


_qr_sessions: dict[str, _QRSession] = {}


def _purge_expired_sessions() -> None:
    expired = [
        sid for sid, s in _qr_sessions.items() if time.monotonic() - s.created_at > QRCODE_SESSION_TTL_SECONDS
    ]
    for sid in expired:
        _qr_sessions.pop(sid, None)


async def start_qrcode_login() -> dict[str, Any]:
    """生成一个二维码登录会话：返回二维码图片地址，前端展示后引导用手机豆瓣 App 扫码"""
    _purge_expired_sessions()
    client = httpx.AsyncClient(timeout=10, follow_redirects=True)
    try:
        resp = await client.get(
            QRCODE_CODE_URL,
            headers={"User-Agent": UA, "Referer": "https://accounts.douban.com/passport/login"},
        )
        data = resp.json()
        payload = data.get("payload") or {}
        code = payload.get("code", "")
        img = payload.get("img", "")
        if not code or not img:
            await client.aclose()
            return {"ok": False, "error": "获取二维码失败，豆瓣接口可能已变更或触发风控"}
    except Exception:
        await client.aclose()
        return {"ok": False, "error": "请求豆瓣二维码接口失败，请检查网络后重试"}

    session_id = uuid.uuid4().hex
    _qr_sessions[session_id] = _QRSession(client, code)
    if img.startswith("//"):
        img = "https:" + img

    # 浏览器直连豆瓣图常因防盗链裂图；服务端带 Referer 拉取后改 data URL 返回
    try:
        img_resp = await client.get(
            img,
            headers={
                "User-Agent": UA,
                "Referer": "https://accounts.douban.com/passport/login",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
        )
        if img_resp.status_code == 200 and img_resp.content and len(img_resp.content) > 80:
            ctype = (img_resp.headers.get("content-type") or "image/png").split(";")[0].strip()
            if not ctype.startswith("image/"):
                ctype = "image/png"
            b64 = base64.b64encode(img_resp.content).decode("ascii")
            img = f"data:{ctype};base64,{b64}"
    except Exception:
        # 拉取失败时仍回传原 URL，前端至少有机会尝试
        pass

    return {"ok": True, "session_id": session_id, "qrcode_url": img}


async def poll_qrcode_login(session_id: str) -> dict[str, Any]:
    """轮询扫码状态；确认登录后从 cookie jar 中提取登录态 Cookie 并关闭会话"""
    session = _qr_sessions.get(session_id)
    if not session:
        return {"status": "expired"}
    if time.monotonic() - session.created_at > QRCODE_SESSION_TTL_SECONDS:
        _qr_sessions.pop(session_id, None)
        await session.client.aclose()
        return {"status": "expired"}
    try:
        resp = await session.client.get(
            QRCODE_STATUS_URL,
            params={"ck": "", "code": session.code},
            headers={"User-Agent": UA, "Referer": "https://accounts.douban.com/passport/login"},
        )
        data = resp.json()
        login_status = (data.get("payload") or {}).get("login_status", "")
    except Exception:
        return {"status": "waiting"}

    if login_status != "login":
        return {"status": "waiting"}

    cookie_str = "; ".join(f"{k}={v}" for k, v in session.client.cookies.items())
    _qr_sessions.pop(session_id, None)
    probe = await check_cookie(cookie_str)
    await session.client.aclose()
    if not probe["valid"]:
        return {"status": "error", "error": "扫码已确认，但校验登录态失败，请改用 Cookie 方式登录"}
    return {
        "status": "success",
        "cookie": cookie_str,
        "user_id": probe["user_id"],
        "user_name": probe["name"],
    }
