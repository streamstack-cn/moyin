"""
citation_service.py — 引用规则引擎

严格依据《写作格式规范视频笔记》实现：
  脚注格式：作者，《书名》（出版地：出版社，出版年份），引用页码。
  译著格式：作者（英文名）著，《书名》，译者译（出版地：出版社，出版年份），引用页码。
  连续引用同一本书 → 仅留"作者，书名，页码"
  与上一条同书同页 → "同上。"；同书不同页 → "同上，页码。"
  参考书目：另起一页、去重、去页码、标点改句号、按第一作者姓氏笔画数升序排列
"""

import json
import re
from dataclasses import dataclass, field
from typing import Optional

from services import opencc_service, stroke_table


def _format_page_part(page_no: str) -> str:
    """脚注页码：纯数字只写数字（如 ，22）；已含「页」或其它写法则原样保留。"""
    p = (page_no or "").strip()
    if not p:
        return ""
    # 「第22页」等写法归一为纯数字
    m = re.fullmatch(r"第?\s*(\d+)\s*页?", p)
    if m:
        return f"，{m.group(1)}"
    if re.fullmatch(r"\d+", p):
        return f"，{p}"
    return f"，{p}"


def format_pub_date_zh(raw: str) -> str:
    """出版年月规范化为中文样式：2024-01 / 2024-1 → 2024年1月。"""
    s = (raw or "").strip()
    if not s:
        return ""

    # 已是中文样式：去掉月日前的多余 0
    m = re.fullmatch(r"(\d{4})\s*年\s*0?(\d{1,2})\s*月(?:\s*0?(\d{1,2})\s*日)?", s)
    if m:
        y, mo = m.group(1), int(m.group(2))
        if m.group(3):
            return f"{y}年{mo}月{int(m.group(3))}日"
        return f"{y}年{mo}月"

    if re.fullmatch(r"\d{4}\s*年", s):
        return re.sub(r"\s+", "", s)

    # ISO / 常见西式：2024-01-15、2024-1、2024/01、2024.01
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?", s)
    if m:
        y, mo = m.group(1), int(m.group(2))
        if not (1 <= mo <= 12):
            return s
        if m.group(3):
            day = int(m.group(3))
            if 1 <= day <= 31:
                return f"{y}年{mo}月{day}日"
        return f"{y}年{mo}月"

    # 仅年份
    m = re.fullmatch(r"(\d{4})", s)
    if m:
        return f"{m.group(1)}年"

    return s


def _load_authors(authors_field: str) -> list[str]:
    if not authors_field:
        return []
    try:
        data = json.loads(authors_field)
        if isinstance(data, list):
            return [str(a) for a in data if a]
    except (json.JSONDecodeError, TypeError):
        pass
    return [a.strip() for a in str(authors_field).split(",") if a.strip()]


def _format_authors(authors: list[str]) -> str:
    if not authors:
        return "佚名"
    if len(authors) == 1:
        return authors[0]
    if len(authors) == 2:
        return "、".join(authors)
    return f"{authors[0]}等"


@dataclass
class BookRef:
    book_id: str
    title: str
    authors: list[str]
    translator: str = ""
    original_title: str = ""
    pub_place: str = ""
    publisher: str = ""
    pub_date: str = ""

    @classmethod
    def from_book(cls, book) -> "BookRef":
        return cls(
            book_id=book.id,
            title=book.title or "",
            authors=_load_authors(book.authors),
            translator=book.translator or "",
            original_title=book.original_title or "",
            pub_place=book.pub_place or "",
            publisher=book.publisher or "",
            pub_date=book.pub_date or "",
        )


@dataclass
class CitationEntry:
    book: BookRef
    page_no: str = ""
    quoted_text: str = ""


@dataclass
class RenderedFootnote:
    order: int
    text: str
    quoted_text: str = ""


def _pub_info(ref: BookRef) -> str:
    """（出版地：出版社，出版年份）— 出版地缺失时优雅降级"""
    date = format_pub_date_zh(ref.pub_date)
    if ref.pub_place and ref.publisher:
        return f"（{ref.pub_place}：{ref.publisher}，{date}）" if date else f"（{ref.pub_place}：{ref.publisher}）"
    if ref.publisher:
        return f"（{ref.publisher}，{date}）" if date else f"（{ref.publisher}）"
    return f"（{date}）" if date else ""


def _full_footnote(ref: BookRef, page_no: str) -> str:
    authors_str = _format_authors(ref.authors)
    page_part = _format_page_part(page_no)
    if ref.translator:
        return f"{authors_str}著，《{ref.title}》，{ref.translator}译{_pub_info(ref)}{page_part}。"
    return f"{authors_str}，《{ref.title}》{_pub_info(ref)}{page_part}。"


def _short_footnote(ref: BookRef, page_no: str) -> str:
    authors_str = _format_authors(ref.authors)
    page_part = _format_page_part(page_no)
    return f"{authors_str}，《{ref.title}》{page_part}。"


def render_footnotes(entries: list[CitationEntry], variant: str = "simplified") -> list[RenderedFootnote]:
    """按引用篮顺序生成脚注文本；假定篮内条目顺序即写作中出现顺序（同一次导出视为在同一页连续引用）"""
    rendered: list[RenderedFootnote] = []
    seen_books: set[str] = set()
    prev: Optional[CitationEntry] = None

    for i, entry in enumerate(entries):
        ref = entry.book
        if prev and prev.book.book_id == ref.book_id:
            if prev.page_no and prev.page_no == entry.page_no:
                text = "同上。"
            else:
                page_part = _format_page_part(entry.page_no)
                text = f"同上{page_part}。" if page_part else "同上。"
        elif ref.book_id in seen_books:
            text = _short_footnote(ref, entry.page_no)
        else:
            text = _full_footnote(ref, entry.page_no)

        seen_books.add(ref.book_id)
        text = opencc_service.to_variant(text, variant)
        rendered.append(RenderedFootnote(order=i + 1, text=text, quoted_text=entry.quoted_text))
        prev = entry

    return rendered


def _bibliography_line(ref: BookRef) -> str:
    authors_str = _format_authors(ref.authors)
    place_pub = (
        f"{ref.pub_place}：{ref.publisher}" if ref.pub_place and ref.publisher else (ref.publisher or "出版信息不详")
    )
    date = format_pub_date_zh(ref.pub_date)
    date_part = f"，{date}" if date else ""
    if ref.translator:
        return f"{authors_str}著。《{ref.title}》。{ref.translator}译。{place_pub}{date_part}。"
    return f"{authors_str}。《{ref.title}》。{place_pub}{date_part}。"


@dataclass
class BibliographyItem:
    text: str
    stroke_estimated: bool
    sort_key: tuple


def render_bibliography(entries: list[CitationEntry], variant: str = "simplified") -> list[BibliographyItem]:
    """去重、去页码、句号化，并按第一作者姓氏笔画数升序排列"""
    unique_refs: dict[str, BookRef] = {}
    for entry in entries:
        unique_refs.setdefault(entry.book.book_id, entry.book)

    items: list[BibliographyItem] = []
    for ref in unique_refs.values():
        first_author = ref.authors[0] if ref.authors else ""
        strokes, matched = stroke_table.stroke_count(first_author, variant)
        text = opencc_service.to_variant(_bibliography_line(ref), variant)
        items.append(BibliographyItem(text=text, stroke_estimated=matched, sort_key=(strokes, first_author)))

    items.sort(key=lambda it: it.sort_key)
    return items
