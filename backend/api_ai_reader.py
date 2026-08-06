"""
api_ai_reader.py — 墨引 MoYin AI 伴读 API

路由前缀：/api/ai-reader

每位用户独立配置 AI Key，互相隔离，管理员无法跨用户查看 Key 或报告。

端点：
  GET    /api/ai-reader/providers              — 推荐服务商列表
  GET    /api/ai-reader/config                 — 读取当前用户 AI 配置（脱敏 Key）
  PUT    /api/ai-reader/config                 — 保存当前用户 AI 配置
  GET    /api/ai-reader/config/test            — 测试连通性（临时 Key，不写库）
  GET    /api/ai-reader/config/balance         — 查询账户余额
  GET    /api/ai-reader/config/models          — 拉取可用模型列表
  PUT    /api/ai-reader/portrait               — 保存用户 AI 画像
  GET    /api/ai-reader/books                  — 获取已读/在读书目
  GET    /api/ai-reader/material               — 获取选中书的素材（高亮/笔记/引用）
  POST   /api/ai-reader/generate/stream        — 流式生成伴读报告（SSE）
  GET    /api/ai-reader/report                 — 读取缓存报告
  DELETE /api/ai-reader/report                 — 删除缓存报告
  POST   /api/ai-reader/chat                   — 追问对话（以报告为上下文）
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import (
    AiReadingReport, Book, BookContentChunk, BookNote, CitationBasketItem,
    CitationProject, Highlight, User, UserAiConfig,
)
from security import get_current_user

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lib.ai_core import (
    PROVIDERS,
    check_balance,
    chat_completion,
    chat_completion_stream,
    detect_provider,
    fetch_available_models,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-reader", tags=["AI 伴读"])


# ────────────────────────────────────────────────────────────────────────────
# Pydantic 模型
# ────────────────────────────────────────────────────────────────────────────

class AiConfigUpdate(BaseModel):
    base_url: str
    api_key: str
    model: str
    output_lang: str = "zh"
    output_length: str = "standard"


class AiPortraitUpdate(BaseModel):
    reading_style: str = ""         # 深度思考型 / 快速浏览型 / 实用主义型
    output_tone: str = ""           # 学术严谨 / 轻松易读 / 批判性
    focus_areas: List[str] = []     # 方法论 / 实践指导 / 理论基础
    extra_prompt: str = ""          # 用户自定义附加要求


class GenerateRequest(BaseModel):
    book_ids: List[str]
    force: bool = False             # 强制重新生成，忽略缓存
    include_full_text: bool = False  # 是否将书本全文纳入分析（适合无高亮的本子）
    full_text_chars: int = 12000     # 全文模式最大字数（默认 12000）


class ChatRequest(BaseModel):
    book_ids: List[str]
    messages: List[dict]            # [{role, content}]


# ────────────────────────────────────────────────────────────────────────────
# 工具函数
# ────────────────────────────────────────────────────────────────────────────

def _book_ids_hash(book_ids: list[str], include_full_text: bool = False) -> str:
    """对 book_ids 排序后取 SHA256 前 16 字节 hex，用于快速定位缓存报告。
    include_full_text 加入哈希，避免全文/非全文报告互相命中缓存。
    """
    suffix = ":full" if include_full_text else ":normal"
    joined = ",".join(sorted(book_ids)) + suffix
    return hashlib.sha256(joined.encode()).hexdigest()[:32]


def _get_or_create_config(user_id: str, db: Session) -> UserAiConfig:
    cfg = db.query(UserAiConfig).filter(UserAiConfig.user_id == user_id).first()
    if not cfg:
        cfg = UserAiConfig(user_id=user_id)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _mask_key(api_key: str) -> str:
    """脱敏显示 API Key（只留前 6 位 + *** + 末 4 位）。"""
    if not api_key or len(api_key) <= 10:
        return "***" if api_key else ""
    return api_key[:6] + "***" + api_key[-4:]


def _require_ai_config(cfg: UserAiConfig) -> dict:
    """检查 AI 是否已配置，返回标准化 config dict，否则抛 400。"""
    if not cfg.api_key:
        raise HTTPException(
            status_code=400,
            detail="请先在「AI 伴读 → 设置」中填写 API Key 并保存"
        )
    return {
        "base_url": cfg.base_url or "https://api.siliconflow.cn/v1",
        "api_key": cfg.api_key,
        "model": cfg.model or "Qwen/Qwen3-8B",
        "max_tokens": _length_to_tokens(cfg.output_length),
        "temperature": 0.7,
    }


def _length_to_tokens(length: str) -> int:
    # 结构化 JSON 报告（内容概括 + 核心收获 + 个人思考 + 知识关联 + 阅读建议）
    # 中文输出普遍比英文更耗 token，篇幅稍长、或选中了全文分析时很容易顶到
    # 旧的 3000 上限被硬切断，导致流出来的 JSON 不完整、最终解析失败。
    # 适当调高，给模型足够空间把 JSON 完整收尾。
    return {"concise": 2500, "standard": 4500, "detailed": 8000}.get(length or "standard", 4500)


def _load_portrait(cfg: UserAiConfig) -> dict:
    try:
        data = json.loads(cfg.ai_portrait or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _format_length_desc(length: str) -> str:
    return {
        "concise":  "简洁精炼（800−1200 字）",
        "standard": "标准深度（1500−2000 字）",
        "detailed": "详尽全面（2500−3500 字）",
    }.get(length or "standard", "标准深度（1500−2000 字）")


def _word_count_instruction(length: str) -> str:
    return {
        "concise":  "全文总字数参考 1000−1200 汉字（字数仅为建议，无需刻板遵守，重点在于内容的深度与价值）。",
        "standard": "全文总字数参考 1500−2000 汉字（字数仅为建议，无需刻板遵守，重点在于内容的深度与价值）。",
        "detailed": "全文总字数参考 3000−4000 汉字（字数仅为建议，无需刻板遵守，重点在于内容的深度与价值）。",
    }.get(length or "standard", "全文总字数参考 1500−2000 汉字（字数仅为建议，无需刻板遵守，重点在于内容的深度与价值）。")


def _format_lang_desc(lang: str) -> str:
    return "繁体中文" if lang == "zh-tw" else "简体中文"


# ────────────────────────────────────────────────────────────────────────────
# Prompt 工程
# ────────────────────────────────────────────────────────────────────────────

def _build_persona_lines(cfg: UserAiConfig) -> list[str]:
    """人设/口吻/画像相关的公共前缀——报告生成和追问对话都要用，
    但两者对「输出格式」的要求完全不同，所以格式相关的指令不放在这里，
    分别由各自的 prompt builder 追加。"""
    portrait = _load_portrait(cfg)
    style = portrait.get("reading_style") or "深度思考型"
    tone = portrait.get("output_tone") or "轻松易读"
    focus = portrait.get("focus_areas") or []
    extra = portrait.get("extra_prompt") or ""

    lines = [
        "你是一位深刻的阅读顾问和学术写作辅导者。",
        "你精通《如何阅读一本书》的四层读法，并擅长帮助读者将自己的高亮、笔记、引用整理成",
        "一份严谨、个性化、适合学术引用的《个人阅读报告》。",
        "",
        f"输出语言：{_format_lang_desc(cfg.output_lang)}。",
        f"用户阅读风格：{style}。",
        f"输出语气：{tone}。",
    ]
    if focus:
        lines.append(f"用户重点关注：{'\u3001'.join(focus)}。")
    if extra:
        lines.append(f"用户附加要求：{extra}")
    return lines


def _build_system_prompt(cfg: UserAiConfig) -> str:
    length = cfg.output_length or "standard"
    parts = _build_persona_lines(cfg) + [
        _word_count_instruction(length),
        "",
        "核心原则：",
        "1. 这份报告的主角是《读者本人的阅读体验》，而不是书籍摘要或全文复述。用户提供的高亮/笔记/"
        "引用是本次分析的第一手材料和绝对主线——报告必须从这些具体内容出发展开思考，而不是脱离它们"
        "泛泛而谈整本书。若同时提供了「书本全文节选」，那只是用来帮你理解上下文、核实细节的背景资料，"
        "篇幅占比不能反客为主，报告里不应大段复述全文内容。",
        "2. 「核心收获」「个人思考」中的每一条，尽量能让读者看出具体对应到了哪一条高亮/笔记/引用"
        "（可以在论证部分简要带出原文片段或提到「笔记中提到…」），避免写成空泛、放在任何一本同类书"
        "上都成立的通用评论。",
        "3. 相似书籍推荐必须真实存在，不能虚造书名和作者。",
        "4. 《可引用段落》直接来自用户已高亮的原文，加上书名作为来源注释。",
        "5. 《学术小结》150−200字，格式规范，可直接拷贝进论文参考文献内容注释。",
        "6. 请严格按照指定 JSON schema 输出，不要输出任何 JSON 之外的内容。",
        "7. 全文必须使用简体中文表达，包括内部小标题/分段标签在内，禁止出现 insight / argument / "
        "argumentation / point / reflection / my_thought_process 等英文字段名或标签词——即使是分点罗列，"
        "也请直接用「要点：」「论证：」「我的思考：」这类中文词，不要中英混杂。",
    ]
    return "\n".join(parts)


_REPORT_SCHEMA = """{
  "content_summary": "[内容概括] 站在读者本人的角度，基于我提供的标注和笔记，概括书本内容及核心框架；切忌以翻译者或旁观者的口吻复述。此部分是报告的重中之重，应分配较多篇幅。",
  "core_insights": "[核心收获] 若我提供了高亮/笔记/引用：从中提炼出 3−5 个最重要的思想收获，每一条都必须能对应到我标注过的具体内容，不要写成脱离我的标注、放在任何读者身上都成立的通用评论，论证部分请点出具体依据的是哪一条高亮/笔记/引用（可简述或直接带出原文片段）；若我完全没有提供任何标注（只有全文节选可用），则基于全文合理提炼 3−5 个收获即可。每条统一按「要点：…」「论证：…」「我的思考：…」三段中文标签展开，不要使用任何英文标签。",
  "personal_reflections": "[个人思考] 紧扣我的高亮、笔记与引用，结合我的实际经历或知识背景，展开对这些具体内容的深度思考和批判；这也是报告的核心部分，需要详尽展开，字数重点倾斜于此。",
  "knowledge_map": "[知识关联] 这本书与我已知知识体系的连接点，以及它如何修正或拓展了我的认知。",
  "reading_advice": "[阅读建议] 给未来的自己或类似读者：这本书应该怎么读、哪些章节值得精读、读完后应做啥。",
  "similar_books": [
    {
      "title": "书名",
      "author": "作者",
      "reason": "推荐理由：与本书的关联和认知价值"
    }
  ],
  "quotable_passages": [
    {
      "text": "可直接引用的原文段落（来自用户高亮）",
      "context": "引用场景或学术语境建议"
    }
  ],
  "book_summary_for_citation": "[学术引用小结] 150−200 字的书目描述，格式规范，可直接用于论文参考文献的内容注释。"
}"""


def _build_generate_prompt(books_data: list[dict], cfg: UserAiConfig) -> str:
    lines = ["请分析以下书籍，生成 6 大模块的深度伴读报告。", ""]

    for b in books_data:
        lines.append(f"【书籍】《{b['title']}》")
        if b.get("authors"):
            lines.append(f"  作者：{', '.join(b['authors'])}")
        if b.get("file_format"):
            lines.append(f"  格式：{b['file_format'].upper()}")
        if b.get("description"):
            lines.append(f"  简介：{b['description'][:300]}")
        lines.append("")

        has_user_material = (
            b.get("highlights") or b.get("note_content") or b.get("citations")
        )
        has_full_text = b.get("full_text_chapters")

        # ── 用户标注素材 ──
        if b.get("highlights"):
            lines.append(f"  【用户高亮划线（{len(b['highlights'])} 条）】")
            for i, h in enumerate(b["highlights"][:30], 1):
                lines.append(f"    {i}. 「{h['text']}」" + (f"  [笔记：{h['note']}]" if h.get("note") else ""))
            lines.append("")

        if b.get("note_content"):
            lines.append(f"  【读书笔记】\n{b['note_content'][:1500]}")
            lines.append("")

        if b.get("citations"):
            lines.append(f"  【引用条目（{len(b['citations'])} 条）】")
            for i, c in enumerate(b["citations"][:20], 1):
                lines.append(f"    {i}. 「{c['text']}」" + (f"  [分组：{c['group']}]" if c.get("group") else ""))
            lines.append("")

        # ── 书本全文（自动补充或用户主动开启）──
        if has_full_text:
            total_chapters = len(b["full_text_chapters"])
            if has_user_material:
                # 用户已经有高亮/笔记/引用——全文只是背景参考，绝不能让它成为报告主线
                auto_note = "（背景参考资料，仅用于辅助理解上下文，不是分析重点）"
                lines.append(f"  【书本全文节选 {auto_note} — 共 {total_chapters} 个章节段落】")
                lines.append("  ⚠️ 以下内容只做背景参考：报告的核心分析必须紧扣上面【用户高亮/笔记/引用】展开，")
                lines.append("  不要脱离用户实际标注、转而大段复述或分析下面的全文节选。")
            else:
                auto_note = "（用户暂无高亮/笔记/引用，素材不足，自动补充全文作为分析依据）"
                lines.append(f"  【书本全文节选 {auto_note} — 共 {total_chapters} 个章节段落】")
            for ch in b["full_text_chapters"]:
                ch_title = ch.get("title") or f"第 {ch['index'] + 1} 章"
                lines.append(f"  ── {ch_title} ──")
                lines.append(f"  {ch['text']}")
                lines.append("")
        elif not has_user_material:
            lines.append("  ⚠️ 注意：该书暂无全文索引（PDF 可能尚未完成 Calibre 格式转换建库），")
            lines.append("  请仅基于书名、作者、简介进行分析，并在报告中说明素材有限。")

        lines.append("")

    lines += [
        "请严格按照以下 JSON 格式输出（不要输出其他任何内容）：",
        _REPORT_SCHEMA,
    ]
    return "\n".join(lines)


def _build_chat_system_prompt(cfg: UserAiConfig, report_json: dict, books_data: list[dict]) -> str:
    """
    追问对话的 system prompt。
    之前这里直接复用 _build_system_prompt()——但那份 prompt 里有一条给「生成报告」用的
    强制指令「请严格按照指定 JSON schema 输出，不要输出任何 JSON 之外的内容」，追问场景
    完全不需要这条，模型却会优先服从它，于是把整份报告 JSON 原样吐回来当聊天回复，
    格式自然很难看。这里改成只复用人设/口吻部分，格式要求单独按「自然语言对话」来写。
    """
    persona = "\n".join(_build_persona_lines(cfg))
    book_titles = "、".join(f"《{b['title']}》" for b in books_data)
    report_str = json.dumps(report_json, ensure_ascii=False, indent=2)
    return (
        persona
        + f"\n\n你已经为用户完成了 {book_titles} 的伴读报告，内容如下（仅供你参考背景，不要直接输出）：\n\n{report_str}\n\n"
        "用户现在希望针对报告内容进一步追问或深入探讨。回答要求：\n"
        "1. 用自然流畅的简体中文段落或分点作答，像正常聊天/答疑一样，不要输出 JSON、代码块、"
        "或任何形如「字段名：值」的结构化格式。\n"
        "2. 不要重新输出整份报告或大段照抄已有内容，聚焦回答用户这一次具体提出的问题。\n"
        "3. 回答要简洁、有深度，观点需要给出具体理由，并尽量与已有报告的立场保持一致（如需修正，"
        "说明修正原因）。"
    )


# ────────────────────────────────────────────────────────────────────────────
# 数据加载
# ────────────────────────────────────────────────────────────────────────────

# 全文单本当前 token 上限：算入 prompt 开销后留全文小于输出 tokens
# concise=1500 / standard=3000 / detailed=6000→ 全文上限设为 3倍输出 tokens
_FULL_TEXT_CHAR_LIMIT = {
    "concise": 8000,
    "standard": 15000,
    "detailed": 30000,
}


def _load_book_full_text(
    book_id: str, db: Session, max_chars: int = 15000
) -> list[dict]:
    """
    从 BookContentChunk 读取书本全文，按章节顺序返回。
    每个元素：{chapter_index, chapter_title, text}
    总字数超过 max_chars 后截断（保留头尾内容，跳过中间过长章节）。
    """
    chunks = (
        db.query(BookContentChunk)
        .filter(BookContentChunk.book_id == book_id)
        .order_by(BookContentChunk.chapter_index)
        .all()
    )
    if not chunks:
        return []

    result: list[dict] = []
    n = len(chunks)

    # 策略：优先头和尾（序言、结论），中间章节按顺序拶取
    # 头部 35%，尾部 20%，中间 45%
    head_limit = int(max_chars * 0.35)
    tail_limit = int(max_chars * 0.20)
    mid_limit = max_chars - head_limit - tail_limit

    def _take(ch_list: list, limit: int) -> list[dict]:
        taken: list[dict] = []
        used = 0
        for c in ch_list:
            text = (c.text or "").strip()
            if not text:
                continue
            if used + len(text) > limit:
                # 切尾额外纳入一个截断展示
                remaining = limit - used
                if remaining > 200:
                    taken.append({
                        "index": c.chapter_index,
                        "title": c.chapter_title or f"第 {c.chapter_index + 1} 章",
                        "text": text[:remaining] + "…（内容截断）",
                    })
                break
            taken.append({
                "index": c.chapter_index,
                "title": c.chapter_title or f"第 {c.chapter_index + 1} 章",
                "text": text,
            })
            used += len(text)
        return taken

    head_chunks = chunks[:max(1, n // 3)]
    tail_chunks = chunks[max(0, n - max(1, n // 5)):]
    mid_chunks  = chunks[max(1, n // 3): max(0, n - max(1, n // 5))]

    result  = _take(head_chunks, head_limit)
    result += _take(mid_chunks, mid_limit)
    result += _take(tail_chunks, tail_limit)
    return result


def _load_books_material(
    book_ids: list[str],
    user_id: str,
    db: Session,
    include_full_text: bool = False,
    full_text_chars: int = 15000,
    exclude_ids: list[str] = None,
) -> list[dict]:
    """加载选中书的元数据 + 用户高亮 + 笔记 + 引用素材。"""
    exclude_ids = exclude_ids or []
    books_data = []
    for book_id in book_ids:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            continue

        # 高亮
        highlights_raw = (
            db.query(Highlight)
            .filter(Highlight.book_id == book_id, Highlight.user_id == user_id)
            .order_by(Highlight.created_at)
            .all()
        )
        highlights = [
            {"id": h.id, "text": h.quoted_text, "note": h.note, "chapter": h.chapter_title}
            for h in highlights_raw if h.quoted_text and h.id not in exclude_ids
        ]

        # 笔记
        note = db.query(BookNote).filter(
            BookNote.book_id == book_id, BookNote.user_id == user_id
        ).first()
        if note and note.id in exclude_ids:
            note = None

        # 引用篮条目（通过 project_id → CitationProject.user_id 隔离）
        citations_raw = (
            db.query(CitationBasketItem)
            .join(CitationProject, CitationProject.id == CitationBasketItem.project_id)
            .filter(
                CitationBasketItem.book_id == book_id,
                CitationProject.user_id == user_id,
            )
            .order_by(CitationBasketItem.order_index)
            .all()
        )
        citations = [
            {"id": c.id, "text": c.quoted_text, "group": c.group_name}
            for c in citations_raw if c.quoted_text and c.id not in exclude_ids
        ]

        try:
            authors = json.loads(book.authors or "[]")
        except Exception:
            authors = []

        # 判断是否自动补充全文（高亮 + 引用 < 5 条时自动开启）
        user_material_count = len(highlights) + len(citations) + (1 if note and note.content else 0)
        should_include_full_text = include_full_text or (user_material_count < 5)

        # Bug fix: has_full_text_index 始终独立查询，不受 should_include_full_text 控制
        # 这样前端能正确显示「该书是否有全文索引」的状态
        has_full_text_index: bool = db.query(
            db.query(BookContentChunk.id)
            .filter(BookContentChunk.book_id == book_id)
            .exists()
        ).scalar()

        full_text_chapters: list[dict] = []
        if should_include_full_text:
            full_text_chapters = _load_book_full_text(
                book_id, db, max_chars=full_text_chars
            )

        books_data.append({
            "id": book_id,
            "title": book.title or "未知书名",
            "has_full_text_index": has_full_text_index,
            "note_id": note.id if note else None,
            "note_content": note.content if note else "",
            "authors": authors,
            "description": book.description or "",
            "file_format": book.file_format or "",
            "cover_url": f"/api/books/{book_id}/cover",
            "highlights": highlights,
            "citations": citations,
            "full_text_chapters": full_text_chapters,
            "used_full_text": should_include_full_text,
        })
    return books_data


# ────────────────────────────────────────────────────────────────────────────
# API 端点
# ────────────────────────────────────────────────────────────────────────────

@router.get("/providers")
async def get_providers(user: User = Depends(get_current_user)):
    """返回推荐 AI 服务商列表（硅基流动/DeepSeek 优先）。"""
    result = []
    order = ["siliconflow", "deepseek", "kimi", "qwen", "openai", "gemini", "custom"]
    for key in order:
        info = PROVIDERS.get(key, {})
        result.append({
            "key": key,
            "name": info.get("name", key),
            "base_url": info.get("base_url", ""),
            "has_balance": info.get("has_balance", False),
            "recommended": info.get("recommended", False),
            "signup_url": info.get("signup_url", ""),
            "models": info.get("models", []),
        })
    return result


@router.get("/config")
async def get_config(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """读取当前用户的 AI 配置（API Key 脱敏）。"""
    cfg = _get_or_create_config(user.id, db)
    portrait = _load_portrait(cfg)
    return {
        "has_key": bool(cfg.api_key),
        "base_url": cfg.base_url,
        "api_key_masked": _mask_key(cfg.api_key),
        "model": cfg.model,
        "output_lang": cfg.output_lang,
        "output_length": cfg.output_length,
        "ai_portrait": portrait,
        "provider": detect_provider(cfg.base_url or ""),
    }


@router.put("/config")
async def save_config(
    payload: AiConfigUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """保存当前用户的 AI 配置。"""
    cfg = _get_or_create_config(user.id, db)
    cfg.base_url = payload.base_url.strip().rstrip("/") or "https://api.siliconflow.cn/v1"
    if payload.api_key and not payload.api_key.startswith("***"):
        cfg.api_key = payload.api_key.strip()
    cfg.model = payload.model.strip()
    cfg.output_lang = payload.output_lang
    cfg.output_length = payload.output_length
    db.commit()
    return {"ok": True}


@router.get("/config/test")
async def test_config(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    base_url: str = Query(default=""),
    api_key: str = Query(default=""),
    model: str = Query(default=""),
):
    """测试 AI 连通性，传入参数时使用临时配置（不写入数据库）。"""
    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
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
        "model": model.strip() or cfg.model or "Qwen/Qwen3-8B",
        "max_tokens": 10,
        "temperature": 0.7,
    }

    try:
        result = await chat_completion(
            messages=[{"role": "user", "content": "Say 'ok'."}],
            config=test_cfg,
            system_prompt="Reply with exactly: ok",
        )
        return {
            "ok": True,
            "model": test_cfg["model"],
            "reply": result["content"][:100],
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/config/balance")
async def get_balance(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    base_url: str = Query(default=""),
    api_key: str = Query(default=""),
):
    """查询账户余额（仅支持硅基流动 / DeepSeek / Kimi）。"""
    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/"):
            req_api_key = cfg.api_key
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        raise HTTPException(status_code=400, detail="AI API Key 未配置")

    check_cfg = {"base_url": req_base_url, "api_key": req_api_key}

    try:
        result = await check_balance(check_cfg)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"余额查询失败: {e}")

    if result is None:
        provider = detect_provider(check_cfg.get("base_url", ""))
        return {"supported": False, "provider": provider, "message": "该厂商暂不支持余额查询"}

    return {"supported": True, **result}


@router.get("/config/models")
async def get_models(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    base_url: str = Query(default=""),
    api_key: str = Query(default=""),
):
    """拉取可用模型列表。"""
    cfg = _get_or_create_config(user.id, db)
    req_base_url = base_url.strip() or cfg.base_url or "https://api.siliconflow.cn/v1"
    req_api_key = api_key.strip()
    if not req_api_key:
        if req_base_url.rstrip("/") == (cfg.base_url or "").rstrip("/"):
            req_api_key = cfg.api_key
        else:
            raise HTTPException(status_code=400, detail="已切换服务商，请输入对应的 API Key")
    if not req_api_key:
        return []

    fetch_cfg = {"base_url": req_base_url, "api_key": req_api_key}

    try:
        return await fetch_available_models(fetch_cfg)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.put("/portrait")
async def save_portrait(
    payload: AiPortraitUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """保存用户 AI 画像。"""
    cfg = _get_or_create_config(user.id, db)
    cfg.ai_portrait = json.dumps(payload.model_dump(), ensure_ascii=False)
    db.commit()
    return {"ok": True}


@router.get("/books")
async def get_readable_books(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    q: str = Query(default=""),
):
    """获取用户已读/在读书目，用于 AI 伴读选书。"""
    from models import ReadingProgress
    from services import progress_service

    progress_service.heal_finished_progress(db, user.id)
    # 获取有阅读进度（在读/已读）的书；未满 3% 不算在读
    progresses = (
        db.query(ReadingProgress)
        .filter(ReadingProgress.user_id == user.id)
        .all()
    )
    book_status: dict[str, str] = {}
    for p in progresses:
        st = progress_service.status_from_percent(p.percent, stored_status=p.status)
        if st in ("reading", "finished"):
            book_status[p.book_id] = st

    # 结合高亮、引用等标记状态
    query = db.query(Book)
    if q.strip():
        query = query.filter(Book.title.ilike(f"%{q.strip()}%"))
    books = query.order_by(Book.added_at.desc()).all()

    result = []
    for book in books:
        status = book_status.get(book.id, "unread")
        if not q.strip() and status not in ("reading", "finished"):
            continue

        try:
            authors = json.loads(book.authors or "[]")
        except Exception:
            authors = []

        hl_count = db.query(Highlight).filter(
            Highlight.book_id == book.id, Highlight.user_id == user.id
        ).count()
        note = db.query(BookNote).filter(
            BookNote.book_id == book.id, BookNote.user_id == user.id
        ).first()
        citation_count = (
            db.query(CitationBasketItem)
            .join(CitationProject, CitationProject.id == CitationBasketItem.project_id)
            .filter(
                CitationBasketItem.book_id == book.id,
                CitationProject.user_id == user.id,
            )
            .count()
        )

        result.append({
            "id": book.id,
            "title": book.title or "未知书名",
            "authors": authors,
            "cover_url": f"/api/books/{book.id}/cover",
            "file_format": book.file_format or "",
            "reading_status": status,
            "highlight_count": hl_count,
            "has_note": bool(note and note.content),
            "citation_count": citation_count,
        })

    # 按状态排序：reading > finished > unread
    order_map = {"reading": 0, "finished": 1, "unread": 2}
    result.sort(key=lambda x: (order_map.get(x["reading_status"], 2), -x["highlight_count"]))
    return result


@router.get("/material")
async def get_material(
    book_ids: str = Query(description="逗号分隔的书 ID"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取选中书的高亮/笔记/引用素材预览。"""
    ids = [i.strip() for i in book_ids.split(",") if i.strip()]
    if not ids:
        return []
    # 素材预览端点：always pass include_full_text=False（前端仅展示用户标注素材）
    # 全文数据仅在 has_full_text_index 字段体现（用于前端决定是否显示「结合全文」开关）
    return _load_books_material(ids, user.id, db, include_full_text=False)


@router.get("/report")
async def get_report(
    book_ids: str = Query(description="逗号分隔的书 ID"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """读取缓存的伴读报告。优先返回最新生成的（全文/非全文均搜索）。"""
    ids = [i.strip() for i in book_ids.split(",") if i.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="book_ids 不能为空")
    hashes = [_book_ids_hash(ids, True), _book_ids_hash(ids, False)]
    report = (
        db.query(AiReadingReport)
        .filter(
            AiReadingReport.user_id == user.id,
            AiReadingReport.book_ids_hash.in_(hashes),
        )
        .order_by(AiReadingReport.generated_at.desc())
        .first()
    )
    if not report:
        return None
    try:
        report_data = json.loads(report.report_json)
    except Exception:
        report_data = {}
    return {
        "id": report.id,
        "book_ids": json.loads(report.book_ids),
        "report": report_data,
        "generated_at": report.generated_at.isoformat() if report.generated_at else None,
    }


@router.delete("/report")
async def delete_report(
    book_ids: str = Query(description="逗号分隔的书 ID"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除缓存报告（全文/非全文均删除，触发重新生成）。"""
    ids = [i.strip() for i in book_ids.split(",") if i.strip()]
    hashes = [_book_ids_hash(ids, True), _book_ids_hash(ids, False)]
    db.query(AiReadingReport).filter(
        AiReadingReport.user_id == user.id,
        AiReadingReport.book_ids_hash.in_(hashes),
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.post("/generate/stream")
async def generate_report_stream(
    book_ids: str = Query(...),
    exclude_ids: str = Query(""),
    include_full_text: bool = Query(True),
    full_text_chars: int = Query(15000),
    force: bool = Query(False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    流式生成 AI 伴读报告（SSE）。

    事件格式：
      data: {"content": "<文字片段>"}\\n\\n
      data: [DONE]\\n\\n
      data: {"error": "<错误信息>"}\\n\\n
    """
    ids = [i.strip() for i in book_ids.split(",") if i.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="请至少选择一本书")

    cfg = _get_or_create_config(user.id, db)
    ai_cfg = _require_ai_config(cfg)

    exclude_list = [i.strip() for i in exclude_ids.split(",") if i.strip()]
    books_data = _load_books_material(
        ids, user.id, db,
        include_full_text=include_full_text,
        full_text_chars=full_text_chars,
        exclude_ids=exclude_list,
    )
    if not books_data:
        raise HTTPException(status_code=404, detail="未找到选中的书籍")

    # 检查是否有缓存（非强制重生成时）
    bh = _book_ids_hash(ids, include_full_text=include_full_text)
    if not force:
        existing = db.query(AiReadingReport).filter(
            AiReadingReport.user_id == user.id,
            AiReadingReport.book_ids_hash == bh,
        ).first()
        if existing:
            # 直接流式回放缓存报告
            async def replay():
                yield f"data: {json.dumps({'content': existing.report_json, 'cached': True}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(replay(), media_type="text/event-stream",
                                     headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    system_prompt = _build_system_prompt(cfg)
    user_prompt = _build_generate_prompt(books_data, cfg)
    messages = [{"role": "user", "content": user_prompt}]

    # 用于收集完整响应以持久化
    full_content: list[str] = []
    user_id_captured = user.id
    book_ids_captured = ids

    async def event_generator():
        try:
            async for chunk in chat_completion_stream(messages, ai_cfg, system_prompt):
                full_content.append(chunk)
                yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

            # 持久化报告
            complete = "".join(full_content)
            try:
                # 尝试解析 JSON（AI 输出可能带有代码块包裹）
                clean = complete.strip()
                if clean.startswith("```"):
                    clean = clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                report_data = json.loads(clean)
            except Exception:
                report_data = {"raw": complete}

            # 写入或更新缓存
            existing_rec = db.query(AiReadingReport).filter(
                AiReadingReport.user_id == user_id_captured,
                AiReadingReport.book_ids_hash == bh,
            ).first()
            if existing_rec:
                existing_rec.report_json = json.dumps(report_data, ensure_ascii=False)
                from datetime import datetime
                existing_rec.generated_at = datetime.utcnow()
            else:
                new_report = AiReadingReport(
                    user_id=user_id_captured,
                    book_ids=json.dumps(book_ids_captured),
                    book_ids_hash=bh,
                    report_json=json.dumps(report_data, ensure_ascii=False),
                )
                db.add(new_report)
            db.commit()

            yield "data: [DONE]\n\n"

        except Exception as e:
            err = str(e)
            logger.error(f"[AI伴读] 生成报告失败: {err}")
            yield f"data: {json.dumps({'error': err}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat")
async def chat_with_report(
    req: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    以伴读报告为上下文的追问对话（非流式）。
    """
    if not req.book_ids or not req.messages:
        raise HTTPException(status_code=400, detail="book_ids 和 messages 不能为空")

    cfg = _get_or_create_config(user.id, db)
    ai_cfg = _require_ai_config(cfg)

    # 读取报告作为上下文（chat 不区分全文模式，优先读取已有报告）
    bh_full = _book_ids_hash(req.book_ids, include_full_text=True)
    bh_normal = _book_ids_hash(req.book_ids, include_full_text=False)
    report_rec = db.query(AiReadingReport).filter(
        AiReadingReport.user_id == user.id,
        AiReadingReport.book_ids_hash.in_([bh_full, bh_normal]),
    ).order_by(AiReadingReport.generated_at.desc()).first()
    report_data = {}
    if report_rec:
        try:
            report_data = json.loads(report_rec.report_json)
        except Exception:
            pass

    books_data = _load_books_material(req.book_ids, user.id, db, include_full_text=True)
    system_prompt = _build_chat_system_prompt(cfg, report_data, books_data)

    messages = [{"role": m["role"], "content": m["content"]} for m in req.messages]

    try:
        result = await chat_completion(messages, ai_cfg, system_prompt)
        return {
            "content": result["content"],
            "prompt_tokens": result["prompt_tokens"],
            "completion_tokens": result["completion_tokens"],
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

class ReportUpdateRequest(BaseModel):
    report_json: dict

@router.get("/reports")
async def list_reports(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reports = db.query(AiReadingReport).filter(AiReadingReport.user_id == user.id).order_by(AiReadingReport.generated_at.desc()).all()
    res = []
    for r in reports:
        try:
            b_ids = json.loads(r.book_ids) if r.book_ids else []
        except:
            b_ids = []
        books = db.query(Book.id, Book.title, Book.cover_path).filter(Book.id.in_(b_ids)).all()
        res.append({
            "id": r.id,
            "book_ids": b_ids,
            "books": [{"id": b.id, "title": b.title, "cover": f"/api/books/{b.id}/cover" if b.cover_path else None} for b in books],
            "generated_at": r.generated_at.isoformat() if r.generated_at else None,
        })
    return res

@router.put("/report/{report_id}")
async def update_report(
    report_id: str,
    req: ReportUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    report = db.query(AiReadingReport).filter(AiReadingReport.id == report_id, AiReadingReport.user_id == user.id).first()
    if not report:
        raise HTTPException(404, "Report not found")
    report.report_json = json.dumps(req.report_json, ensure_ascii=False)
    db.commit()
    return {"success": True}

@router.delete("/report/{report_id}")
async def delete_report_by_id(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    report = db.query(AiReadingReport).filter(AiReadingReport.id == report_id, AiReadingReport.user_id == user.id).first()
    if not report:
        raise HTTPException(404, "Report not found")
    db.delete(report)
    db.commit()
    return {"success": True}
