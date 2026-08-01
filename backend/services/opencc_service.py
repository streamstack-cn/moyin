"""opencc_service.py — 简繁转换（导出引用/参考书目时按需切换）"""

from functools import lru_cache


@lru_cache(maxsize=1)
def _converters():
    from opencc import OpenCC

    return {
        "t2s": OpenCC("t2s"),  # 繁体 → 简体，先归一化
        "s2t": OpenCC("s2twp"),  # 简体 → 繁体（含地区惯用词转换）
    }


def to_variant(text: str, variant: str) -> str:
    if not text:
        return text
    try:
        cc = _converters()
        normalized = cc["t2s"].convert(text)
        if variant == "traditional":
            return cc["s2t"].convert(normalized)
        return normalized
    except Exception:
        return text
