import asyncio
import httpx

async def _download_cover_image(url: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://book.douban.com/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        print(resp.status_code, resp.headers)
        print(len(resp.content))

asyncio.run(_download_cover_image("https://img9.doubanio.com/view/subject/s/public/s33821735.jpg"))
