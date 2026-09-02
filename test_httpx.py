import asyncio
import httpx
import uvicorn
from fastapi import FastAPI, Header, Request
from fastapi.responses import RedirectResponse
import threading
import time

app = FastAPI()

@app.get("/redirect")
def do_redirect(request: Request):
    return RedirectResponse(url="/target")

@app.get("/target")
def target(request: Request):
    return {"cookie": request.headers.get("cookie")}

def run_server():
    uvicorn.run(app, host="127.0.0.1", port=9999, log_level="critical")

async def main():
    threading.Thread(target=run_server, daemon=True).start()
    await asyncio.sleep(1)
    
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get("http://127.0.0.1:9999/redirect", headers={"Cookie": "my_cookie=123"})
        print("Headers approach:", resp.json())

if __name__ == "__main__":
    asyncio.run(main())
