"""
lib/ai_core.py — 墨引 MoYin 内联 AI 客户端

支持 OpenAI-compatible API（硅基流动、DeepSeek、Kimi、通义千问、OpenAI、Gemini 兼容层）。
不依赖任何外部 labs 目录，moyin 项目独立可用。

核心功能：
  - chat_completion(messages, config, system_prompt)         → 标准对话
  - chat_completion_stream(messages, config, system_prompt)  → SSE 流式
  - fetch_available_models(config)                           → 模型列表
  - check_balance(config)                                    → 余额查询（部分厂商）
  - detect_provider(base_url)                                → 识别服务商
  - PROVIDERS                                                → 推荐服务商常量
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator, Optional

import httpx

logger = logging.getLogger(__name__)

# ── 推荐服务商预设 ────────────────────────────────────────────────────────────
PROVIDERS: dict[str, dict] = {
    "siliconflow": {
        "name": "硅基流动",
        "base_url": "https://api.siliconflow.cn/v1",
        "has_balance": True,
        "recommended": True,
        "signup_url": "https://cloud.siliconflow.cn/i/JVhipsPG",
        "models": [
            "Qwen/Qwen3-8B",
            "Qwen/Qwen3-14B",
            "Qwen/Qwen3-32B",
            "Qwen/QwQ-32B",
            "Qwen/Qwen2.5-72B-Instruct",
            "deepseek-ai/DeepSeek-V3",
            "deepseek-ai/DeepSeek-R1",
            "THUDM/glm-4-9b-chat",
            "Pro/Qwen/Qwen2.5-7B-Instruct",
        ],
    },
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "has_balance": True,
        "recommended": True,
        "signup_url": "https://platform.deepseek.com",
        "models": ["deepseek-chat", "deepseek-reasoner"],
    },
    "kimi": {
        "name": "Kimi (Moonshot)",
        "base_url": "https://api.moonshot.cn/v1",
        "has_balance": True,
        "signup_url": "https://platform.moonshot.cn",
        "models": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "moonshot-v1-auto"],
    },
    "qwen": {
        "name": "通义千问",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "has_balance": False,
        "signup_url": "https://bailian.console.aliyun.com/?apiKey=1",
        "models": ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long", "qwq-32b"],
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "has_balance": False,
        "signup_url": "https://platform.openai.com/api-keys",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini", "o3-mini"],
    },
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "has_balance": False,
        "signup_url": "https://aistudio.google.com/apikey",
        "models": [
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-2.0-pro-exp-0205",
        ],
    },
    "custom": {
        "name": "自定义",
        "base_url": "",
        "has_balance": False,
        "models": [],
    },
}

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


def detect_provider(base_url: str) -> str:
    """根据 base_url 识别服务商 key。"""
    url = (base_url or "").lower()
    if "siliconflow" in url:
        return "siliconflow"
    if "deepseek" in url:
        return "deepseek"
    if "moonshot" in url:
        return "kimi"
    if "dashscope" in url or "qwen" in url:
        return "qwen"
    if "generativelanguage" in url or "gemini" in url:
        return "gemini"
    if "openai" in url:
        return "openai"
    return "custom"


def _create_client(config: dict, timeout = 15.0) -> httpx.AsyncClient:
    proxy = config.get("http_proxy")
    t = timeout if isinstance(timeout, httpx.Timeout) else httpx.Timeout(timeout)
    return httpx.AsyncClient(timeout=t, proxy=proxy if proxy else None)

def _clean_key(api_key: str) -> str:
    k = (api_key or "").strip()
    if k.lower().startswith("bearer "):
        k = k[7:].strip()
    return k


def _build_headers(api_key: str, base_url: str = "") -> dict:
    clean = _clean_key(api_key)
    headers = {
        "Authorization": f"Bearer {clean}",
        "Content-Type": "application/json",
    }
    url_lower = (base_url or "").lower()
    if "generativelanguage" in url_lower or "google" in url_lower or "gemini" in url_lower:
        headers["x-goog-api-key"] = clean
    return headers


def _build_messages(messages: list[dict], system_prompt: Optional[str]) -> list[dict]:
    """组装 messages，把 system_prompt 插入为首条 system 消息。"""
    result = []
    if system_prompt:
        result.append({"role": "system", "content": system_prompt})
    result.extend(messages)
    return result


async def chat_completion(
    messages: list[dict],
    config: dict,
    system_prompt: Optional[str] = None,
) -> dict:
    """
    标准非流式对话。

    返回：
      {"content": str, "prompt_tokens": int, "completion_tokens": int, "total_tokens": int}
    """
    base_url = config["base_url"].rstrip("/")
    api_key = config["api_key"]
    model = config.get("model", "gpt-4o-mini")
    max_tokens = config.get("max_tokens", 4096)
    temperature = config.get("temperature", 0.7)

    payload: dict = {
        "model": model,
        "messages": _build_messages(messages, system_prompt),
    }
    if max_tokens and max_tokens > 0:
        payload["max_tokens"] = max_tokens
    if temperature is not None:
        payload["temperature"] = temperature

    params = None
    if "generativelanguage" in base_url.lower() or "gemini" in base_url.lower():
        params = {"key": _clean_key(api_key)}

    async with _create_client(config, _TIMEOUT) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers=_build_headers(api_key, base_url),
            params=params,
            json=payload,
        )

    if resp.status_code != 200:
        _raise_ai_error(resp)

    data = resp.json()
    choice = data["choices"][0]
    content = choice["message"]["content"] or ""
    usage = data.get("usage") or {}

    return {
        "content": content,
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
    }


async def chat_completion_stream(
    messages: list[dict],
    config: dict,
    system_prompt: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    流式对话，每次 yield 一个文本片段（delta content）。
    """
    base_url = config["base_url"].rstrip("/")
    api_key = config["api_key"]
    model = config.get("model", "gpt-4o-mini")
    max_tokens = config.get("max_tokens", 4096)
    temperature = config.get("temperature", 0.7)

    payload: dict = {
        "model": model,
        "messages": _build_messages(messages, system_prompt),
        "stream": True,
    }
    if max_tokens and max_tokens > 0:
        payload["max_tokens"] = max_tokens
    if temperature is not None:
        payload["temperature"] = temperature

    params = None
    if "generativelanguage" in base_url.lower() or "gemini" in base_url.lower():
        params = {"key": _clean_key(api_key)}

    async with _create_client(config, _TIMEOUT) as client:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers=_build_headers(api_key, base_url),
            params=params,
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                _raise_ai_error_raw(resp.status_code, body)

            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    chunk = json.loads(line)
                    delta = chunk["choices"][0].get("delta", {})
                    text = delta.get("content", "")
                    if text:
                        yield text
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


async def fetch_available_models(config: dict) -> list[str]:
    """
    向服务商拉取可用模型列表。
    """
    base_url = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    provider_key = detect_provider(base_url)

    params = None
    if "generativelanguage" in base_url.lower() or "gemini" in base_url.lower():
        params = {"key": _clean_key(api_key)}

    try:
        async with _create_client(config, 15.0) as client:
            resp = await client.get(
                f"{base_url}/models",
                headers=_build_headers(api_key, base_url),
                params=params,
            )
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("data") or data.get("models") or []
            models = []
            for m in items:
                if isinstance(m, dict) and "id" in m:
                    mid = m["id"]
                    if mid.startswith("models/"):
                        mid = mid[7:]
                    models.append(mid)
                elif isinstance(m, str):
                    mid = m[7:] if m.startswith("models/") else m
                    models.append(mid)
            if models:
                return sorted(list(set(models)))
        else:
            _raise_ai_error(resp)
    except Exception as e:
        logger.debug(f"拉取模型列表失败: {e}")
        # 若是服务商不支持 /models 或触发限流，外层 api_ai_reader 会进行兜底处理
        raise e

    # 回退到预设列表
    return PROVIDERS.get(provider_key, {}).get("models", [])


async def check_balance(config: dict) -> Optional[dict]:
    """
    查询 API Key 余额。
    支持：硅基流动、DeepSeek、Kimi。
    不支持的厂商返回 None。

    成功返回：
      {"currency": "CNY", "total_balance": float, "available_balance": float}
    """
    base_url = config.get("base_url", "")
    api_key = config.get("api_key", "")
    provider = detect_provider(base_url)

    if provider == "siliconflow":
        return await _balance_siliconflow(config)
    elif provider == "deepseek":
        return await _balance_deepseek(config)
    elif provider == "kimi":
        return await _balance_kimi(config)
    return None


async def _balance_siliconflow(config: dict) -> Optional[dict]:
    api_key = config.get("api_key", "")
    base_url = (config.get("base_url") or "https://api.siliconflow.cn/v1").rstrip("/")
    clean_k = _clean_key(api_key)

    # 优先根据用户当前配置的域名（.cn 或 .com）确定首选与后备地址
    if "siliconflow.com" in base_url:
        endpoints = [
            "https://api.siliconflow.com/v1/user/info",
            "https://api.siliconflow.cn/v1/user/info",
        ]
    else:
        endpoints = [
            "https://api.siliconflow.cn/v1/user/info",
            "https://api.siliconflow.com/v1/user/info",
        ]

    headers = {
        "Authorization": f"Bearer {clean_k}",
        "Accept": "application/json",
    }

    last_resp = None
    last_err = None
    async with _create_client(config, 10.0) as client:
        for ep in endpoints:
            try:
                resp = await client.get(ep, headers=headers)
                last_resp = resp
                if resp.status_code == 200:
                    data = resp.json()
                    info = data.get("data", {}) or {}
                    balance = float(info.get("totalBalance", 0) or 0)
                    charged = float(info.get("chargeBalance", 0) or 0)
                    free = float(info.get("balance", 0) or 0)
                    return {
                        "currency": "CNY",
                        "total_balance": balance,
                        "available_balance": charged + free,
                        "charged_balance": charged,
                        "free_balance": free,
                    }
                # 若主域名遭遇 401 且还有备用域名，尝试备用域名
            except Exception as e:
                last_err = e
                continue

    if last_resp is not None:
        _raise_ai_error(last_resp)
    elif last_err is not None:
        raise RuntimeError(f"硅基流动余额查询失败: {last_err}")
    raise RuntimeError("硅基流动余额查询失败: 无响应")

async def _balance_deepseek(config: dict) -> Optional[dict]:
    try:
        async with _create_client(config, 10.0) as client:
            resp = await client.get(
                "https://api.deepseek.com/user/balance",
                headers=_build_headers(config.get("api_key", "")),
            )
        if resp.status_code == 200:
            data = resp.json()
            info = data.get("balance_infos", [{}])[0] if data.get("balance_infos") else {}
            return {
                "currency": info.get("currency", "CNY"),
                "total_balance": float(info.get("total_balance", 0) or 0),
                "available_balance": float(info.get("available_balance", 0) or 0),
            }
        _raise_ai_error(resp)
    except Exception as e:
        if isinstance(e, RuntimeError): raise e
        logger.debug(f"DeepSeek 余额查询失败: {e}")
        raise RuntimeError(f"DeepSeek 余额查询失败: {e}")

async def _balance_kimi(config: dict) -> Optional[dict]:
    try:
        async with _create_client(config, 10.0) as client:
            resp = await client.get(
                "https://api.moonshot.cn/v1/users/me/balance",
                headers=_build_headers(config.get("api_key", "")),
            )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "currency": "CNY",
                "total_balance": float(data.get("total_balance", 0) or 0),
                "available_balance": float(data.get("available_balance", 0) or 0),
            }
        _raise_ai_error(resp)
    except Exception as e:
        if isinstance(e, RuntimeError): raise e
        logger.debug(f"Kimi 余额查询失败: {e}")
        raise RuntimeError(f"Kimi 余额查询失败: {e}")


def _raise_ai_error(resp: httpx.Response) -> None:
    """解析 API 错误响应，抛出友好的 RuntimeError。"""
    try:
        data = resp.json()
        msg = (
            data.get("error", {}).get("message")
            or data.get("message")
            or str(data)
        )
    except Exception:
        msg = resp.text[:500]
    raise RuntimeError(f"AI API 错误 [{resp.status_code}]: {msg}")


def _raise_ai_error_raw(status_code: int, body: bytes) -> None:
    try:
        data = json.loads(body)
        msg = (
            data.get("error", {}).get("message")
            or data.get("message")
            or str(data)
        )
    except Exception:
        msg = body[:500].decode("utf-8", errors="replace")
    raise RuntimeError(f"AI API 错误 [{status_code}]: {msg}")
