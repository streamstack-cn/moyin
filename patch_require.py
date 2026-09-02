with open("backend/api_ai_reader.py", "r", encoding="utf-8") as f:
    content = f.read()

target = """def _require_ai_config(cfg: UserAiConfig) -> dict:
    \"\"\"检查 AI 是否已配置，返回标准化 config dict，否则抛 400。\"\"\"
    if not cfg.api_key:
        raise HTTPException(
            status_code=400,
            detail="请先在「AI 伴读 → 设置」中填写 API Key 并保存"
        )
    return {
        "provider_configs": json.loads(cfg.provider_configs or "{}"),
        "base_url": cfg.base_url or "https://api.siliconflow.cn/v1",
        "api_key": cfg.api_key,
        "http_proxy": pcfg.get("http_proxy", cfg.http_proxy),
        "model": cfg.model or "Qwen/Qwen3-8B",
        "max_tokens": _length_to_tokens(cfg.output_length),
        "temperature": 0.7,
    }"""
    
replacement = """def _require_ai_config(cfg: UserAiConfig) -> dict:
    \"\"\"检查 AI 是否已配置，返回标准化 config dict，否则抛 400。\"\"\"
    base_url = cfg.base_url or "https://api.siliconflow.cn/v1"
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
content = content.replace(target, replacement)
with open("backend/api_ai_reader.py", "w", encoding="utf-8") as f:
    f.write(content)
