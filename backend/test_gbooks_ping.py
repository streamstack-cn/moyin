import asyncio
from services.google_books_service import ping
async def test():
    res = await ping("AIzaSyCgmo_Tn5qyFosChHA7m_VAbHZHZFlxdOU", "http://192.168.0.101:6152")
    print(res)

asyncio.run(test())
