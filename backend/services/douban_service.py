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

import base64
import json
import re
import time
import uuid
from typing import Any, Optional

import httpx
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

SUGGEST_URL = "https://book.douban.com/j/subject_suggest"
SEARCH_URL = "https://search.douban.com/book/subject_search"
SUBJECT_URL = "https://book.douban.com/subject/{id}/"
MINE_URL = "https://www.douban.com/mine/"
QRCODE_CODE_URL = "https://accounts.douban.com/j/mobile/login/qrlogin_code"
QRCODE_STATUS_URL = "https://accounts.douban.com/j/mobile/login/qrlogin_status"
QRCODE_SESSION_TTL_SECONDS = 5 * 60

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


def _headers(cookie: str = "", referer: str = "https://book.douban.com/") -> dict:
    headers = {
        "User-Agent": UA,
        "Referer": referer,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if cookie:
        headers["Cookie"] = cookie
    return headers


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
    """探活 Cookie：访问 /mine/，登录态会 302 到 /people/<id>/"""
    if not cookie:
        return {"valid": False, "user_id": "", "name": ""}
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            resp = await client.get(MINE_URL, headers=_headers(cookie))
    except Exception:
        return {"valid": False, "user_id": "", "name": ""}

    match = re.search(r"/people/([^/]+)/", str(resp.url))
    if not match:
        return {"valid": False, "user_id": "", "name": ""}
    user_id = match.group(1)
    name = parse_douban_display_name(resp.text, user_id)
    return {"valid": True, "user_id": user_id, "name": name}


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


async def search_books(query: str, cookie: str = "") -> list[dict[str, Any]]:
    """
    图书搜索：优先走 search.douban.com 搜索页（与 Obsidian 豆瓣插件同源），
    可返回同书名不同年份/出版社的多个版本；失败时回退联想接口。
    """
    q = (query or "").strip()
    if not q:
        return []

    results = await _search_books_via_subject_search(q, cookie)
    if results:
        return results
    return await _search_books_via_suggest(q, cookie)


async def _search_books_via_subject_search(query: str, cookie: str = "") -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                SEARCH_URL,
                params={"search_text": query, "cat": "1001"},
                headers=_headers(cookie, referer="https://book.douban.com/"),
            )
            resp.raise_for_status()
            data = _extract_window_data(resp.text)
    except Exception:
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
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                SUGGEST_URL, params={"q": query}, headers=_headers(cookie)
            )
            resp.raise_for_status()
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
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers=_headers(cookie, referer="https://book.douban.com/"))
            resp.raise_for_status()
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


async def search_and_fetch_best(query: str, cookie: str = "") -> Optional[dict[str, Any]]:
    """搜索并直接抓取第一条匹配结果的详情，供自动匹配元数据使用"""
    candidates = await search_books(query, cookie)
    if not candidates:
        return None
    detail = await get_book_detail(candidates[0]["douban_id"], cookie)
    if detail and not detail.get("cover_url"):
        # 详情页封面失败时，回退联想接口里的缩略图
        detail["cover_url"] = candidates[0].get("cover_url", "")
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
