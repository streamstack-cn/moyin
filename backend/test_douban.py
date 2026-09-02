import asyncio
from services.douban_service import get_book_detail

async def test():
    # ID for some book, e.g. '36622839' (Elon Musk biography)
    detail = await get_book_detail('36622839')
    print("cover_url:", detail.get("cover_url"))

asyncio.run(test())
