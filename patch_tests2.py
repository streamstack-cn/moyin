with open("backend/api_ai_reader.py", "r", encoding="utf-8") as f:
    content = f.read()

test_cfg_target = """    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    req_http_proxy = http_proxy.strip() or cfg.http_proxy
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/"):
            req_api_key = cfg.api_key
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        raise HTTPException(status_code=400, detail="AI API Key 未配置")

    test_cfg = {
        "base_url": req_base_url.rstrip("/"),
        "api_key": req_api_key,
        "http_proxy": req_http_proxy,
        "model": model.strip() or cfg.model or "Qwen/Qwen3-8B","""
        
test_cfg_repl = """    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    pcfg = _get_provider_config(cfg, req_base_url)
    
    req_http_proxy = http_proxy.strip() or pcfg.get("http_proxy", cfg.http_proxy)
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/") or pcfg.get("api_key"):
            req_api_key = pcfg.get("api_key", cfg.api_key)
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        raise HTTPException(status_code=400, detail="AI API Key 未配置")

    test_cfg = {
        "base_url": req_base_url.rstrip("/"),
        "api_key": req_api_key,
        "http_proxy": req_http_proxy,
        "model": model.strip() or pcfg.get("model", cfg.model) or "Qwen/Qwen3-8B","""

content = content.replace(test_cfg_target, test_cfg_repl)

# For get_balance
balance_target = """    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/"):
            req_api_key = cfg.api_key
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        raise HTTPException(status_code=400, detail="AI API Key 未配置")

    req_http_proxy = http_proxy.strip() or cfg.http_proxy"""
    
balance_repl = """    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    pcfg = _get_provider_config(cfg, req_base_url)
    
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/") or pcfg.get("api_key"):
            req_api_key = pcfg.get("api_key", cfg.api_key)
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        raise HTTPException(status_code=400, detail="AI API Key 未配置")

    req_http_proxy = http_proxy.strip() or pcfg.get("http_proxy", cfg.http_proxy)"""

content = content.replace(balance_target, balance_repl)


# For get_models
models_target = """    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/"):
            req_api_key = cfg.api_key
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        return []

    req_http_proxy = http_proxy.strip() or cfg.http_proxy"""
    
models_repl = """    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    pcfg = _get_provider_config(cfg, req_base_url)
    
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/") or pcfg.get("api_key"):
            req_api_key = pcfg.get("api_key", cfg.api_key)
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        return []

    req_http_proxy = http_proxy.strip() or pcfg.get("http_proxy", cfg.http_proxy)"""

content = content.replace(models_target, models_repl)

with open("backend/api_ai_reader.py", "w", encoding="utf-8") as f:
    f.write(content)
