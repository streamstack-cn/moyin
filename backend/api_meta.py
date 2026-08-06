"""api_meta.py — 在线元数据相关辅助接口（封面代理等）"""

import re
from urllib.parse import quote, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix="/api/meta", tags=["Meta"])

# 仅代理已知图书封面 CDN，防止 SSRF
_ALLOWED_HOST_SUFFIXES = (
    "doubanio.com",
    "douban.com",
    "googleusercontent.com",
    "books.google.com",
    "googleapis.com",
)

# 豆瓣封面 CDN：部分节点（常见 img9）会对机房/容器 IP 返回反爬 HTML，需轮换
_DOUBAN_IMG_HOSTS = ("img1", "img2", "img3", "img9")
_DOUBAN_SUBJECT_RE = re.compile(
    r"^https?://img\d\.doubanio\.com/view/subject/([mls])/public/([^/?#]+)$",
    re.I,
)


def _host_allowed(host: str) -> bool:
    host = (host or "").lower().rstrip(".")
    if not host:
        return False
    return any(host == s or host.endswith("." + s) for s in _ALLOWED_HOST_SUFFIXES)


def _looks_like_image(content: bytes, content_type: str) -> bool:
    """拒绝豆瓣反爬返回的 text/html（状态码仍可能是 200）。"""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("image/"):
        return True
    if not content or len(content) < 24:
        return False
    # JPEG / PNG / GIF / WEBP
    if content[:3] == b"\xff\xd8\xff":
        return True
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return True
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return True
    return False


def _cover_candidates(url: str) -> list[str]:
    """生成封面候选：豆瓣 CDN 节点 + 尺寸回退。"""
    ordered: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        if u and u not in seen:
            seen.add(u)
            ordered.append(u)

    m = _DOUBAN_SUBJECT_RE.match(url)
    if m:
        size, name = m.group(1).lower(), m.group(2)
        # 优先稳定节点，img9 常触发反爬放最后
        size_order = [size] + [s for s in ("m", "l", "s") if s != size]
        for host in _DOUBAN_IMG_HOSTS:
            for sz in size_order:
                add(f"https://{host}.doubanio.com/view/subject/{sz}/public/{name}")
    else:
        add(url)
        if "/view/subject/s/" in url:
            add(url.replace("/view/subject/s/", "/view/subject/l/"))
        if "/view/subject/m/" in url:
            add(url.replace("/view/subject/m/", "/view/subject/l/"))

    return ordered


# 封面代理 URL 版本：曾误把豆瓣反爬 HTML 以 max-age=86400 下发，升版本强制浏览器重拉
_COVER_PROXY_VERSION = "2"


def proxied_cover_url(url: str) -> str:
    """把外链封面改成本站代理地址，供 <img> 直接加载。"""
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    if url.startswith("/api/"):
        # 已是代理地址时补上当前版本，避免沿用旧缓存键
        if "v=" not in url:
            sep = "&" if "?" in url else "?"
            return f"{url}{sep}v={_COVER_PROXY_VERSION}"
        return url
    if not url.startswith("http://") and not url.startswith("https://"):
        return url

    return f"/api/meta/cover?url={quote(url, safe='')}&v={_COVER_PROXY_VERSION}"


@router.get("/cover")
async def proxy_cover(url: str = Query(..., min_length=8, max_length=1024)):
    """代理豆瓣/Google 封面，绕过浏览器防盗链（豆瓣 CDN 无 Referer 会 418）。"""
    if url.startswith("//"):
        url = "https:" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not _host_allowed(parsed.hostname or ""):
        raise HTTPException(status_code=400, detail="不允许的封面地址")

    candidates = _cover_candidates(url)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": "https://book.douban.com/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }

    content = b""
    content_type = "image/jpeg"
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for candidate in candidates:
                resp = await client.get(candidate, headers=headers)
                if resp.status_code != 200 or not resp.content or len(resp.content) < 200:
                    continue
                final_host = urlparse(str(resp.url)).hostname or ""
                if not _host_allowed(final_host):
                    continue
                ct = resp.headers.get("content-type", "image/jpeg").split(";")[0]
                if not _looks_like_image(resp.content, ct):
                    # img9 等节点常返回反爬 HTML，继续试下一候选
                    continue
                content = resp.content
                content_type = ct if ct.startswith("image/") else "image/jpeg"
                break
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"封面拉取失败: {exc}") from exc

    if not content:
        raise HTTPException(status_code=404, detail="封面不可用")

    return Response(
        content=content,
        media_type=content_type or "image/jpeg",
        # 代理封面带 ?v= 版本；可较长缓存，版本变更即换 URL
        headers={"Cache-Control": "public, max-age=86400"},
    )
