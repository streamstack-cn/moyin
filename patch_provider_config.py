import json

with open("backend/api_ai_reader.py", "r", encoding="utf-8") as f:
    content = f.read()

# _get_provider_config is already in api_ai_reader.py from my previous step.
# Let's write `_set_provider_config`
set_provider_config_code = """
def _set_provider_config(cfg, base_url: str, payload):
    import json
    try:
        configs = json.loads(cfg.provider_configs or "{}")
    except:
        configs = {}
    
    # Store old one if exists
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

if "def _set_provider_config" not in content:
    content = content.replace("def _require_ai_config", set_provider_config_code + "\ndef _require_ai_config")

# Update get_config
content = content.replace('cfg = _get_or_create_config(user.id, db)\n    portrait = _load_portrait(cfg)', 
'''cfg = _get_or_create_config(user.id, db)
    portrait = _load_portrait(cfg)
    pcfg = _get_provider_config(cfg, cfg.base_url or "")''')

content = content.replace('"has_key": bool(cfg.api_key),', '"has_key": bool(cfg.api_key or pcfg.get("api_key")),')
content = content.replace('"http_proxy": cfg.http_proxy,', '"http_proxy": pcfg.get("http_proxy", cfg.http_proxy),')
content = content.replace('"api_key_masked": _mask_key(cfg.api_key),', '"api_key_masked": _mask_key(pcfg.get("api_key", cfg.api_key)),')
content = content.replace('"model": cfg.model,', '"model": pcfg.get("model", cfg.model),')
content = content.replace('provider_configs = _get_all_provider_configs(cfg)', '')
content = content.replace('    return {', '''    return {
        "provider_configs": json.loads(cfg.provider_configs or "{}"),''')

# Update save_config
save_config_replacement = """    cfg = _get_or_create_config(user.id, db)
    cfg.base_url = payload.base_url.strip().rstrip("/") or "https://api.siliconflow.cn/v1"
    
    _set_provider_config(cfg, cfg.base_url, payload)
    
    if payload.api_key and not payload.api_key.startswith("***"):
        cfg.api_key = payload.api_key.strip()
    cfg.model = payload.model.strip()
    cfg.http_proxy = payload.http_proxy.strip()
    
    cfg.output_lang = payload.output_lang"""

content = content.replace('''    cfg = _get_or_create_config(user.id, db)
    cfg.base_url = payload.base_url.strip().rstrip("/") or "https://api.siliconflow.cn/v1"
    if payload.api_key and not payload.api_key.startswith("***"):
        cfg.api_key = payload.api_key.strip()
    cfg.model = payload.model.strip()
    cfg.http_proxy = payload.http_proxy.strip()
    cfg.output_lang = payload.output_lang''', save_config_replacement)


with open("backend/api_ai_reader.py", "w", encoding="utf-8") as f:
    f.write(content)
