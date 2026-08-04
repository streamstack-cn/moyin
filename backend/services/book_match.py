"""
book_match.py — 图书元数据匹配：文件名清洗 + 多信号打分

灵感来自 streamstack 的 mp_style_parse / TMDB 挑选：
1. 先把「《[图灵程序设计丛书].松本行弘：编程语言的设计与实现》」洗成书名+作者
2. 再用 标题 / 作者 / 出版年 / 出版社 给候选打分，避免盲取第一条
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Optional

# 成对书名号
_BOOK_TITLE_MARK_RE = re.compile(r"^[《「『]+|[》」』]+$")

# 开头成对括号标签：【…】 / […] / （…） / (…)
_LEADING_BRACKET_RE = re.compile(
    r"^(?:【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\))\s*[.\-—_：:·]?\s*"
)

# 括号内/独立垃圾词：格式、扫描、网盘等（非书名主体）
_BOOK_JUNK_TERM = (
    r"扫描版?|高清扫描|文字版|清晰版|完整版|精校版?|校对版?"
    r"|PDF|EPUB|MOBI|AZW3?|TXT|CBZ|CBR"
    r"|电子书|影印本?|复印本?"
    r"|百度(?:网盘)?|夸克(?:网盘)?|阿里(?:云盘)?|迅雷|网盘"
    r"|已完结|合集|全集"
)

_BOOK_JUNK_BRACKET_RE = re.compile(
    r"[\[【（(]\s*(?:"
    + _BOOK_JUNK_TERM
    + r")(?:\s*[/／&、,，]\s*(?:"
    + _BOOK_JUNK_TERM
    + r"))*\s*[\]】）)]",
    re.I,
)

_BOOK_JUNK_TOKEN_RE = re.compile(
    r"^(?:" + _BOOK_JUNK_TERM + r")$",
    re.I,
)

# 尾部扩展名
_EXT_RE = re.compile(
    r"\.(?:epub|pdf|mobi|azw3?|txt|fb2|cbz|cbr)$",
    re.I,
)

# 标题中的年份
_YEAR_RE = re.compile(r"(?:^|[\s\-—_.·（(【\[])((?:19|20)\d{2})(?:$|[\s\-—_.·）)】\]])")

# 比较用：去空白与常见标点
_CMP_PUNCT_RE = re.compile(r"[\s\-_:：。，,.、·•'\"“”‘’!！?？()（）\[\]【】{}<>《》/／\\|]+")

# 常见丛书/出品前缀词
_SERIES_LABEL_HINT = re.compile(
    r"(?:丛书|原创|程序设计|计算机|经典|译丛|文库|系列|精选|合集|选集|文选)$"
)

# 「作者：书名」——左侧像人名时拆分
_AUTHOR_TITLE_SEP_RE = re.compile(r"\s*[:：]\s*")
# 中文人名通常 2~4 字；过长纯中文更像书名（如「编程语言的设计与实现」）
_AUTHOR_LIKE_RE = re.compile(
    r"^[\u4e00-\u9fff]{2,4}(?:·[\u4e00-\u9fff]{1,4})?$"
    r"|^[A-Za-z][A-Za-z\-.'’\s]{1,40}$"
    r"|^[\u4e00-\u9fff]{1,4}\s+[A-Za-z][A-Za-z\-.'’\s]{1,30}$"
)
_NOT_AUTHOR_HINT = re.compile(
    r"(?:丛书|出版社|公司|大学|学院|书店|编委会|编辑部|编著|卷|章|第.版"
    r"|的|与|和|之|及其|以及|设计|实现|技术|教程|指南|实践|原理|基础)"
)


@dataclass
class ParsedBookTitle:
    """从文件名/粗糙书名解析出的匹配线索。"""

    raw: str
    title: str  # 清洗后的主书名
    year: str = ""
    series_tags: list[str] = field(default_factory=list)
    authors: list[str] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)  # 搜索用查询，优先级从高到低


def normalize_cmp(text: str) -> str:
    """标题比较用归一化：小写、去空白标点。"""
    s = (text or "").strip().lower()
    s = _CMP_PUNCT_RE.sub("", s)
    return s


def extract_year(text: str) -> str:
    if not text:
        return ""
    years = _YEAR_RE.findall(text)
    return years[-1] if years else ""


def _looks_like_author(part: str) -> bool:
    s = (part or "").strip()
    if not s or len(s) > 28:
        return False
    if _NOT_AUTHOR_HINT.search(s):
        return False
    if _BOOK_JUNK_TOKEN_RE.fullmatch(s):
        return False
    return bool(_AUTHOR_LIKE_RE.fullmatch(s))


def _split_author_title(text: str) -> tuple[str, list[str]]:
    """识别「松本行弘：编程语言的设计与实现」→ (书名, [作者])."""
    s = (text or "").strip()
    if not s or "://" in s:
        return s, []
    m = _AUTHOR_TITLE_SEP_RE.search(s)
    if not m:
        return s, []
    left, right = s[: m.start()].strip(), s[m.end() :].strip()
    if not left or len(right) < 2:
        return s, []
    # 左侧像人名则拆；右侧也像短人名且几乎等长时不拆（避免「张三：李四」）
    if _looks_like_author(left) and len(right) >= 2:
        if (
            _looks_like_author(right)
            and abs(len(left) - len(right)) <= 1
            and len(right) <= 3
        ):
            return s, []
        return right, [left]
    return s, []


def parse_book_title(raw: str, *, year_hint: str = "", publisher_hint: str = "") -> ParsedBookTitle:
    """清洗图书文件名/标题，生成干净书名、作者与搜索查询。"""
    original = (raw or "").strip()
    if not original:
        return ParsedBookTitle(raw="", title="", queries=[])

    series_tags: list[str] = []
    authors: list[str] = []
    clean = original
    clean = _EXT_RE.sub("", clean)
    # 去掉外层书名号《》「」
    for _ in range(4):
        nxt = _BOOK_TITLE_MARK_RE.sub("", clean).strip()
        if nxt == clean:
            break
        clean = nxt

    # 循环剥离开头 [图灵原创]. / 【xxx】 等标签
    for _ in range(8):
        m = _LEADING_BRACKET_RE.match(clean)
        if not m:
            break
        raw_tag = m.group(0)
        inner = re.sub(r"^[\[【（(]|[\]】）)]$", "", raw_tag.strip(" .—_：:·-"))
        inner = inner.strip("[]【】()（） .—_：:·-")
        if inner:
            series_tags.append(inner)
        clean = clean[m.end() :].strip()

    clean = _BOOK_JUNK_BRACKET_RE.sub(" ", clean)
    clean = re.sub(r"[_\-]{2,}", " ", clean)
    clean = re.sub(r"\s{2,}", " ", clean).strip(" .—_：:·-")
    clean = _BOOK_TITLE_MARK_RE.sub("", clean).strip()

    # 残留以「.」连接的丛书前缀：图灵原创.深入React → 深入React
    # 仅当左侧像丛书标签时剥离，避免误伤「松本行弘.某书」类
    if "." in clean and not clean.startswith("."):
        head, tail = clean.split(".", 1)
        head_s, tail_s = head.strip(), tail.strip()
        head_plain = head_s.strip("[]【】()（）《》")
        if (
            head_s
            and tail_s
            and len(head_plain) <= 18
            and len(tail_s) >= 2
            and re.search(r"[\u4e00-\u9fffA-Za-z]", tail_s)
            and (
                _SERIES_LABEL_HINT.search(head_plain)
                or (head_s.startswith(("[", "【", "（", "(")) and _SERIES_LABEL_HINT.search(head_plain))
            )
        ):
            if head_plain and head_plain not in series_tags:
                series_tags.append(head_plain)
            clean = tail_s

    # 「作者：书名」
    clean, parsed_authors = _split_author_title(clean)
    authors.extend(parsed_authors)

    # token 级去掉纯格式词
    tokens = re.split(r"[\s._]+", clean)
    tokens = [t for t in tokens if t and not _BOOK_JUNK_TOKEN_RE.fullmatch(t)]
    clean = " ".join(tokens).strip() if tokens else clean
    clean = _BOOK_TITLE_MARK_RE.sub("", clean).strip(" .—_-")

    year = (year_hint or "").strip()
    if not year:
        year = extract_year(original) or extract_year(clean)
    if year:
        clean = re.sub(rf"(?<![\u4e00-\u9fffA-Za-z]){re.escape(year)}(?![\u4e00-\u9fffA-Za-z])", " ", clean)
        clean = re.sub(r"\s{2,}", " ", clean).strip(" .—_-")

    if not clean:
        clean = _EXT_RE.sub("", original).strip()
        clean = _BOOK_TITLE_MARK_RE.sub("", clean).strip()

    author = authors[0] if authors else ""
    queries: list[str] = []
    for q in (
        clean,
        f"{clean} {author}".strip() if author else "",
        f"{author} {clean}".strip() if author else "",
        f"{clean} {year}".strip() if year else "",
        f"{clean} {publisher_hint}".strip() if publisher_hint else "",
    ):
        q = re.sub(r"\s{2,}", " ", (q or "").strip())
        if q and q not in queries:
            queries.append(q)

    return ParsedBookTitle(
        raw=original,
        title=clean,
        year=year,
        series_tags=series_tags,
        authors=authors,
        queries=queries or [original],
    )


def _year_of(candidate: dict[str, Any]) -> str:
    for key in ("year", "pub_date", "publishedDate"):
        val = str(candidate.get(key) or "").strip()
        if not val:
            continue
        m = re.search(r"((?:19|20)\d{2})", val)
        if m:
            return m.group(1)
    return ""


def _publisher_of(candidate: dict[str, Any]) -> str:
    return str(candidate.get("publisher") or "").strip()


def _authors_of(candidate: dict[str, Any]) -> list[str]:
    raw = candidate.get("authors")
    if isinstance(raw, list):
        return [str(a).strip() for a in raw if str(a).strip()]
    if isinstance(raw, str) and raw.strip():
        return [p.strip() for p in re.split(r"[/／,，;；]", raw) if p.strip()]
    return []


def title_similarity(a: str, b: str) -> float:
    """标题相似度。

    注意不对称：查询「磐石上的婚姻」不应与短候选「磐石」高分；
    查询被更长书名包含（修订版/副标题）仍可给较高分。
    """
    na, nb = normalize_cmp(a), normalize_cmp(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    # 查询 ⊆ 候选书名（候选更长，如带修订版）
    if na in nb:
        coverage = len(na) / max(len(nb), 1)
        return 0.78 + 0.22 * coverage
    # 候选 ⊆ 查询（候选更短）——短前缀/片段要压分，避免「磐石」盖过全名
    if nb in na:
        coverage = len(nb) / max(len(na), 1)
        if coverage >= 0.92:
            return 0.90
        if coverage >= 0.75:
            return 0.50 + 0.35 * coverage
        return 0.32 * coverage
    return SequenceMatcher(None, na, nb).ratio()


def author_similarity(a: str, b: str) -> float:
    na, nb = normalize_cmp(a), normalize_cmp(b)
    if not na or not nb:
        return 0.0
    if na == nb or na in nb or nb in na:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def score_candidate(
    candidate: dict[str, Any],
    *,
    title: str,
    year: str = "",
    publisher: str = "",
    authors: Optional[list[str]] = None,
) -> float:
    """综合标题 / 作者 / 年份 / 出版社打分，分数越高越可信。"""
    c_title = str(candidate.get("title") or "")
    c_sub = str(candidate.get("sub_title") or candidate.get("subtitle") or "")
    best_title = max(
        title_similarity(title, c_title),
        title_similarity(title, f"{c_title}{c_sub}") if c_sub else 0.0,
        title_similarity(title, c_sub) if c_sub else 0.0,
    )

    score = best_title * 100.0
    # 全名精确匹配额外加权，拉开与短片段候选的差距
    if normalize_cmp(title) and normalize_cmp(title) == normalize_cmp(c_title):
        score += 18

    # 标题几乎不相关时，年份/出版社不得把期刊等噪音抬成「最佳」
    title_ok = best_title >= 0.48

    want_authors = [a for a in (authors or []) if a]
    c_authors = _authors_of(candidate)
    if want_authors and c_authors:
        best_author = max(
            (author_similarity(a, ca) for a in want_authors for ca in c_authors),
            default=0.0,
        )
        if best_author >= 0.9:
            score += 26 if title_ok else 8
        elif best_author >= 0.72:
            score += 14 if title_ok else 4
        elif best_author >= 0.5:
            score += 4 if title_ok else 0
        else:
            score -= 12
    elif want_authors and not c_authors:
        score -= 1

    c_year = _year_of(candidate)
    if year and c_year and title_ok:
        try:
            delta = abs(int(year) - int(c_year))
        except ValueError:
            delta = 99
        if delta == 0:
            score += 28
        elif delta == 1:
            score += 16
        elif delta <= 3:
            score += 4
        else:
            score -= 35
    elif year and not c_year and title_ok:
        score -= 2

    pub = (publisher or "").strip()
    c_pub = _publisher_of(candidate)
    if pub and c_pub and title_ok:
        np, ncp = normalize_cmp(pub), normalize_cmp(c_pub)
        if np == ncp or np in ncp or ncp in np:
            score += 22
        else:
            score -= 6

    try:
        rating = float(candidate.get("rating") or 0)
    except (TypeError, ValueError):
        rating = 0.0
    if rating > 0 and title_ok:
        score += min(rating, 10.0) * 0.35

    return score


def pick_best_candidate(
    candidates: list[dict[str, Any]],
    *,
    title: str,
    year: str = "",
    publisher: str = "",
    authors: Optional[list[str]] = None,
    min_score: float = 58.0,
) -> Optional[dict[str, Any]]:
    """从候选中挑最佳；分数过低则返回 None（宁缺毋滥）。"""
    if not candidates:
        return None
    ranked: list[tuple[float, dict[str, Any]]] = []
    for c in candidates:
        s = score_candidate(
            c, title=title, year=year, publisher=publisher, authors=authors
        )
        ranked.append((s, c))
    ranked.sort(key=lambda x: x[0], reverse=True)
    best_score, best = ranked[0]
    if best_score < min_score:
        return None
    out = dict(best)
    out["_match_score"] = round(best_score, 2)
    return out


def rank_candidates(
    candidates: list[dict[str, Any]],
    *,
    title: str,
    year: str = "",
    publisher: str = "",
    authors: Optional[list[str]] = None,
    min_title_sim: float = 0.0,
) -> list[dict[str, Any]]:
    """按匹配分排序；可按标题相似度丢掉明显无关项（如 Google 期刊噪音）。"""
    scored: list[tuple[float, dict[str, Any]]] = []
    for c in candidates:
        c_title = str(c.get("title") or "")
        c_sub = str(c.get("sub_title") or c.get("subtitle") or "")
        tsim = max(
            title_similarity(title, c_title),
            title_similarity(title, f"{c_title}{c_sub}") if c_sub else 0.0,
        )
        if min_title_sim > 0 and tsim < min_title_sim:
            continue
        s = score_candidate(
            c, title=title, year=year, publisher=publisher, authors=authors
        )
        row = dict(c)
        row["_match_score"] = round(s, 2)
        scored.append((s, row))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [row for _, row in scored]
