"""阅读器划词翻译：短词免费源 + 长短句走用户 AI 配置。"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from lib.ai_core import chat_completion
from models import User
from security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reader", tags=["ReaderTranslate"])

Mode = Literal["auto", "word", "sentence"]

# 短时内存缓存：减少免费接口重复请求
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 600.0
_CACHE_MAX = 256

_WORD_RE = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)?")


class TranslateBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    target_lang: str = "zh"
    mode: Mode = "auto"


class ExplainBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    translation: str = ""
    question: str = ""


def _norm_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _looks_latin(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    latin = sum(1 for c in letters if ("a" <= c.lower() <= "z"))
    return latin / len(letters) >= 0.55


def _detect_mode(text: str, mode: Mode) -> Literal["word", "sentence"]:
    if mode in ("word", "sentence"):
        return mode  # type: ignore[return-value]
    words = _WORD_RE.findall(text)
    if len(words) <= 3 and len(text) <= 40:
        return "word"
    return "sentence"


def _cache_get(key: str) -> Optional[dict[str, Any]]:
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, value = hit
    if time.time() - ts > _CACHE_TTL:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: dict[str, Any]) -> None:
    if len(_CACHE) >= _CACHE_MAX:
        # 丢掉最旧的一批
        for k, _ in sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:64]:
            _CACHE.pop(k, None)
    _CACHE[key] = (time.time(), value)


async def _translate_mymemory(text: str, target: str) -> Optional[str]:
    lang = "zh-CN" if target.startswith("zh") else target
    url = "https://api.mymemory.translated.net/get"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0)) as client:
            resp = await client.get(url, params={"q": text, "langpair": f"en|{lang}"})
        if resp.status_code != 200:
            return None
        data = resp.json()
        translated = (data.get("responseData") or {}).get("translatedText") or ""
        translated = translated.strip()
        if not translated:
            return None
        # MyMemory 失败时常回原文或带 MYMEMORY 警告
        if translated.lower() == text.lower():
            return None
        if "MYMEMORY WARNING" in translated.upper():
            return None
        return translated
    except Exception as exc:
        logger.info("mymemory translate failed: %s", exc)
        return None


async def _translate_dictionary_api(text: str) -> Optional[str]:
    """英英释义降级（无中文时至少给释义）。"""
    word = _WORD_RE.findall(text)
    if not word:
        return None
    q = word[0].lower()
    url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{q}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0)) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if not isinstance(data, list) or not data:
            return None
        meanings = data[0].get("meanings") or []
        defs: list[str] = []
        for m in meanings[:2]:
            part = m.get("partOfSpeech") or ""
            for d in (m.get("definitions") or [])[:2]:
                definition = (d.get("definition") or "").strip()
                if definition:
                    defs.append(f"{part}: {definition}" if part else definition)
        if not defs:
            return None
        return "；".join(defs[:3])
    except Exception as exc:
        logger.info("dictionaryapi failed: %s", exc)
        return None


def _ai_config(db: Session, user: User) -> dict:
    from api_ai_reader import _get_or_create_config, _require_ai_config

    cfg = _get_or_create_config(user.id, db)
    conf = _require_ai_config(cfg)
    conf["temperature"] = 0.2
    conf["max_tokens"] = 800
    return conf


async def _translate_ai(text: str, target: str, db: Session, user: User) -> str:
    conf = _ai_config(db, user)
    lang_name = "简体中文" if target.startswith("zh") else target
    system = (
        f"你是阅读助手。将用户给出的英文（或外文）准确译成{lang_name}。"
        "只输出译文本身，不要解释、不加引号、不写「译文：」前缀。"
        "保留专有名词与术语，语气自然简洁。"
    )
    result = await chat_completion(
        [{"role": "user", "content": text}],
        conf,
        system_prompt=system,
    )
    content = (result.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=502, detail="AI 未返回译文")
    return content


@router.post("/translate")
async def translate_selection(
    body: TranslateBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    text = _norm_text(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="选区为空")
    if len(text) > 4000:
        raise HTTPException(status_code=400, detail="选区过长")

    target = (body.target_lang or "zh").strip() or "zh"
    mode = _detect_mode(text, body.mode)
    cache_key = f"{mode}|{target}|{text.lower()}"
    cached = _cache_get(cache_key)
    if cached:
        return {**cached, "cached": True}

    translation = ""
    provider = "free"
    detail = ""

    if mode == "word":
        translation = (await _translate_mymemory(text, target)) or ""
        if translation:
            provider = "free"
            detail = "mymemory"
        else:
            # 免费失败：有 AI 则降级；否则英英释义
            try:
                translation = await _translate_ai(text, target, db, user)
                provider = "ai"
                detail = "fallback"
            except HTTPException as exc:
                if exc.status_code == 400:
                    en_def = await _translate_dictionary_api(text)
                    if en_def:
                        translation = en_def
                        provider = "free"
                        detail = "dictionaryapi"
                    else:
                        raise HTTPException(
                            status_code=400,
                            detail="免费翻译暂不可用，请先在「AI 伴读」配置 API Key 后重试",
                        ) from exc
                else:
                    raise
    else:
        # 长短句：优先 AI；未配置时尝试免费（质量一般但可用）
        try:
            translation = await _translate_ai(text, target, db, user)
            provider = "ai"
            detail = "chat"
        except HTTPException as exc:
            if exc.status_code == 400:
                translation = (await _translate_mymemory(text, target)) or ""
                if not translation:
                    raise HTTPException(
                        status_code=400,
                        detail="长短句翻译需要 AI。请先在「AI 伴读 → 设置」填写 API Key",
                    ) from exc
                provider = "free"
                detail = "mymemory"
            else:
                raise

    payload = {
        "text": text,
        "translation": translation,
        "target_lang": target,
        "mode": mode,
        "provider": provider,
        "provider_detail": detail,
        "cached": False,
    }
    _cache_set(cache_key, payload)
    return payload


@router.post("/translate/explain")
async def explain_selection(
    body: ExplainBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    text = _norm_text(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="原文为空")
    conf = _ai_config(db, user)
    question = _norm_text(body.question) or "请结合语境解释这段文字的含义与关键用法。"
    translation = _norm_text(body.translation)
    user_content = f"原文：\n{text}\n"
    if translation:
        user_content += f"\n参考译文：\n{translation}\n"
    user_content += f"\n问题：{question}\n请用简洁中文回答。"
    system = (
        "你是英文阅读助手。根据用户给出的原文（与可选译文）回答问题。"
        "解释清楚、简洁，可举一个短例句；不要冗长客套。"
    )
    try:
        result = await chat_completion(
            [{"role": "user", "content": user_content}],
            conf,
            system_prompt=system,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 解释失败：{exc}") from exc
    content = (result.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=502, detail="AI 未返回解释")
    return {"text": text, "explanation": content, "question": question}
