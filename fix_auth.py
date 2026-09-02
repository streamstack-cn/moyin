import re
with open("backend/api_ai_reader.py", "r", encoding="utf-8") as f:
    content = f.read()

target = """    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/"):
            req_api_key = cfg.api_key
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")"""
repl = """    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/") or pcfg.get("api_key"):
            req_api_key = pcfg.get("api_key", cfg.api_key)
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")"""

content = content.replace(target, repl)

with open("backend/api_ai_reader.py", "w", encoding="utf-8") as f:
    f.write(content)
