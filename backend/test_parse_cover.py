import asyncio
import httpx
from bs4 import BeautifulSoup
from services.douban_service import _extract_cover_url

async def main():
    async with httpx.AsyncClient() as client:
        resp = await client.get("https://book.douban.com/subject/36622839/", headers={"User-Agent": "Mozilla/5.0"})
        soup = BeautifulSoup(resp.text, "lxml")
        print("Cover extracted:", _extract_cover_url(soup))

asyncio.run(main())
