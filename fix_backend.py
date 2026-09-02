import re
with open("backend/api_ai_reader.py", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Catch 429/503
target_catch = """    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))"""
repl_catch = """    except Exception as e:
        err_msg = str(e)
        if "429" in err_msg or "503" in err_msg or "Quota" in err_msg or "balance" in err_msg:
            return {
                "ok": True,
                "model": test_cfg["model"] + " (触发服务商限流或配额，但网络已通)",
                "reply": "",
            }
        raise HTTPException(status_code=502, detail=err_msg)"""
content = content.replace(target_catch, repl_catch)

# 2. Add helpers
helpers = """def _get_provider_config(cfg, base_url: str) -> dict:
    import json
    try:
        configs = json.loads(cfg.provider_configs or "{}")
    except:
        configs = {}
    old_url = (cfg.base_url or "").rstrip("/")
    if old_url and old_url not in configs and cfg.api_key:
        configs[old_url] = {"api_key": cfg.api_key, "model": cfg.model, "http_proxy": cfg.http_proxy}
    return configs.get(base_url.rstrip("/"), {})

def _set_provider_config(cfg, base_url: str, payload):
    import json
    try:
        configs = json.loads(cfg.provider_configs or "{}")
    except:
        configs = {}
    old_url = (cfg.base_url or "").rstrip("/")
    if old_url and old_url not in configs and cfg.api_key:
        configs[old_url] = {"api_key": cfg.api_key, "model": cfg.model, "http_proxy": cfg.http_proxy}
        
    url_key = base_url.rstrip("/")
    configs.setdefault(url_key, {})
    if payload.api_key and not payload.api_key.startswith("***"):
        configs[url_key]["api_key"] = payload.api_key.strip()
    configs[url_key]["model"] = payload.model.strip()
    configs[url_key]["http_proxy"] = payload.http_proxy.strip()
    
    cfg.provider_configs = json.dumps(configs, ensure_ascii=False)

"""
content = content.replace("def _require_ai_config", helpers + "def _require_ai_config")

# 3. get_config
target_get_config = """    return {
        "has_key": bool(cfg.api_key),
        "base_url": cfg.base_url,
        "http_proxy": cfg.http_proxy,
        "api_key_masked": _mask_key(cfg.api_key),
        "model": cfg.model,"""
repl_get_config = """    import json
    pcfg = _get_provider_config(cfg, cfg.base_url or "")
    return {
        "provider_configs": json.loads(cfg.provider_configs or "{}"),
        "has_key": bool(cfg.api_key or pcfg.get("api_key")),
        "base_url": cfg.base_url,
        "http_proxy": pcfg.get("http_proxy", cfg.http_proxy),
        "api_key_masked": _mask_key(pcfg.get("api_key", cfg.api_key)),
        "model": pcfg.get("model", cfg.model),"""
content = content.replace(target_get_config, repl_get_config)

# 4. save_config
target_save_config = """    cfg = _get_or_create_config(user.id, db)
    cfg.base_url = payload.base_url.strip().rstrip("/") or "https://api.siliconflow.cn/v1"
    if payload.api_key and not payload.api_key.startswith("***"):
        cfg.api_key = payload.api_key.strip()
    cfg.model = payload.model.strip()
    cfg.http_proxy = payload.http_proxy.strip()
    cfg.output_lang = payload.output_lang"""
repl_save_config = """    cfg = _get_or_create_config(user.id, db)
    cfg.base_url = payload.base_url.strip().rstrip("/") or "https://api.siliconflow.cn/v1"
    
    _set_provider_config(cfg, cfg.base_url, payload)
    
    if payload.api_key and not payload.api_key.startswith("***"):
        cfg.api_key = payload.api_key.strip()
    cfg.model = payload.model.strip()
    cfg.http_proxy = payload.http_proxy.strip()
    cfg.output_lang = payload.output_lang"""
content = content.replace(target_save_config, repl_save_config)

# 5. _require_ai_config
target_require = """    if not cfg.api_key:
        raise HTTPException(
            status_code=400,
            detail="请先在「AI 伴读 → 设置」中填写 API Key 并保存"
        )
    return {
        "base_url": cfg.base_url or "https://api.siliconflow.cn/v1",
        "api_key": cfg.api_key,
        "http_proxy": cfg.http_proxy,
        "model": cfg.model or "Qwen/Qwen3-8B",
        "max_tokens": _length_to_tokens(cfg.output_length),
        "temperature": 0.7,
    }"""
repl_require = """    base_url = cfg.base_url or "https://api.siliconflow.cn/v1"
    pcfg = _get_provider_config(cfg, base_url)
    api_key = pcfg.get("api_key", cfg.api_key)
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="请先在「AI 伴读 → 设置」中填写 API Key 并保存"
        )
    return {
        "base_url": base_url,
        "api_key": api_key,
        "http_proxy": pcfg.get("http_proxy", cfg.http_proxy),
        "model": pcfg.get("model", cfg.model) or "Qwen/Qwen3-8B",
        "max_tokens": _length_to_tokens(cfg.output_length),
        "temperature": 0.7,
    }"""
content = content.replace(target_require, repl_require)

# 6. Auth fallback inside endpoints
target_auth = """    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/"):
            req_api_key = cfg.api_key
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")"""
repl_auth = """    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    pcfg = _get_provider_config(cfg, req_base_url)
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/") or pcfg.get("api_key"):
            req_api_key = pcfg.get("api_key", cfg.api_key)
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")"""
content = content.replace(target_auth, repl_auth)

target_proxy1 = '    req_http_proxy = http_proxy.strip() or cfg.http_proxy\n    req_api_key = api_key.strip()'
repl_proxy1 = '    pcfg = _get_provider_config(cfg, req_base_url)\n    req_http_proxy = http_proxy.strip() or pcfg.get("http_proxy", cfg.http_proxy)\n    req_api_key = api_key.strip()'
content = content.replace(target_proxy1, repl_proxy1)

target_proxy2 = 'req_http_proxy = http_proxy.strip() or cfg.http_proxy'
repl_proxy2 = 'req_http_proxy = http_proxy.strip() or pcfg.get("http_proxy", cfg.http_proxy)'
content = content.replace(target_proxy2, repl_proxy2)

target_model_test = '"model": model.strip() or cfg.model or "Qwen/Qwen3-8B"'
repl_model_test = '"model": model.strip() or pcfg.get("model", cfg.model) or "Qwen/Qwen3-8B"'
content = content.replace(target_model_test, repl_model_test)

with open("backend/api_ai_reader.py", "w", encoding="utf-8") as f:
    f.write(content)
