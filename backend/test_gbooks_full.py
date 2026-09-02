import asyncio
from services.google_books_service import search
async def test():
    try:
        res = await search("python", api_key="AIzaSyCgmo_Tn5qyFosChHA7m_VAbHZHZFlxdOU", max_results=2, proxy="http://192.168.0.101:6152")
        print("Success:", len(res), "results found.")
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
