"""api_meta.py — 在线元数据相关辅助接口（封面代理等）"""

from urllib.parse import urlparse

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


def _host_allowed(host: str) -> bool:
    host = (host or "").lower().rstrip(".")
    if not host:
        return False
    return any(host == s or host.endswith("." + s) for s in _ALLOWED_HOST_SUFFIXES)


def proxied_cover_url(url: str) -> str:
    """把外链封面改成本站代理地址，供 <img> 直接加载。"""
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    if url.startswith("/api/"):
        return url
    if not url.startswith("http://") and not url.startswith("https://"):
        return url
    from urllib.parse import quote

    return f"/api/meta/cover?url={quote(url, safe='')}"


@router.get("/cover")
async def proxy_cover(url: str = Query(..., min_length=8, max_length=1024)):
    """代理豆瓣/Google 封面，绕过浏览器防盗链（豆瓣 CDN 无 Referer 会 418）。"""
    if url.startswith("//"):
        url = "https:" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not _host_allowed(parsed.hostname or ""):
        raise HTTPException(status_code=400, detail="不允许的封面地址")

    candidates = [url]
    if "/view/subject/s/" in url:
        candidates.insert(0, url.replace("/view/subject/s/", "/view/subject/l/"))

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
                if resp.status_code == 200 and resp.content and len(resp.content) > 200:
                    # 跟随跳转后仍须在白名单内
                    final_host = urlparse(str(resp.url)).hostname or ""
                    if not _host_allowed(final_host):
                        continue
                    content = resp.content
                    content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
                    break
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"封面拉取失败: {exc}") from exc

    if not content:
        raise HTTPException(status_code=404, detail="封面不可用")

    return Response(
        content=content,
        media_type=content_type or "image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
