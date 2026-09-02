import asyncio
import httpx

async def main():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        # We can just check what headers are sent on redirect using a local server, 
        # or we can just try visiting the user's profile with their cookie if we had it.
        pass

if __name__ == "__main__":
    asyncio.run(main())
