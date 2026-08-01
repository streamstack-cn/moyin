"""
epub_service.py — EPUB 解析、封面/内嵌元数据提取、章节纯文本抽取（供全文检索）、
以及把 TXT 纯文本包装成标准 EPUB（复用同一套阅读器/高亮/搜索能力）。
"""

import re
import uuid
from pathlib import Path
from typing import Optional

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub


def extract_epub_metadata(path: str) -> dict:
    meta: dict = {}
    try:
        book = epub.read_epub(path, options={"ignore_ncx": True})
    except Exception:
        return meta

    def _first(dc_items):
        return dc_items[0][0] if dc_items else ""

    meta["title"] = _first(book.get_metadata("DC", "title"))
    creators = book.get_metadata("DC", "creator")
    meta["authors"] = [c[0] for c in creators] if creators else []
    meta["publisher"] = _first(book.get_metadata("DC", "publisher"))
    meta["language"] = _first(book.get_metadata("DC", "language")) or "zh"
    meta["description"] = _first(book.get_metadata("DC", "description"))
    meta["pub_date"] = _first(book.get_metadata("DC", "date"))

    identifiers = book.get_metadata("DC", "identifier")
    for value, attrs in identifiers or []:
        scheme = (attrs or {}).get("{http://www.idpf.org/2007/opf}scheme", "").lower()
        if "isbn" in scheme or (value and re.match(r"^[\d\-Xx]{10,17}$", value.strip())):
            meta["isbn"] = re.sub(r"[^0-9Xx]", "", value)
            break
    return meta


def _image_from_html_page(book, doc_item) -> Optional["ebooklib.epub.EpubItem"]:
    """很多转码工具（含 Calibre）不写 <meta name="cover"> 清单项，而是生成一个
    只包含一张大图的"封面页"（如 cover.xhtml）。这里解析该页面的 <img>，
    按相对路径在 manifest 里找到对应的图片条目"""
    try:
        soup = BeautifulSoup(doc_item.get_content(), "lxml")
    except Exception:
        return None
    img = soup.find("img") or soup.find("image")
    src = img.get("src") or img.get("xlink:href") or img.get("href") if img else None
    if not src:
        return None
    # doc_item.get_name() 是相对 EPUB 根目录的路径，img src 是相对该文档所在目录的路径
    base_dir = Path(doc_item.get_name()).parent
    target_name = str((base_dir / src).as_posix()) if not src.startswith("/") else src.lstrip("/")
    # 去掉可能的 ../ 归一化
    target_name = str(Path(target_name).as_posix())
    for image_item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
        if image_item.get_name().replace("\\", "/") == target_name or image_item.get_name().endswith(
            Path(src).name
        ):
            return image_item
    return None


def extract_epub_cover(path: str, dest_dir: str) -> Optional[str]:
    try:
        book = epub.read_epub(path, options={"ignore_ncx": True})
    except Exception:
        return None

    cover_item = None
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_COVER:
            cover_item = item
            break
    if cover_item is None:
        for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
            if "cover" in item.get_name().lower():
                cover_item = item
                break
    if cover_item is None:
        # 兜底 1：找名字含 "cover" 的封面页（如 cover.xhtml），取其内嵌图片
        for doc_item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            if "cover" in doc_item.get_name().lower():
                cover_item = _image_from_html_page(book, doc_item)
                if cover_item:
                    break
    if cover_item is None:
        # 兜底 2：书脊（spine）第一页多数情况下就是封面页，即使文件名没有 "cover" 字样
        spine_ids = [s[0] for s in book.spine[:1]]
        for item_id in spine_ids:
            doc_item = book.get_item_with_id(item_id)
            if doc_item is not None:
                cover_item = _image_from_html_page(book, doc_item)
                if cover_item:
                    break

    if cover_item is None:
        return None

    Path(dest_dir).mkdir(parents=True, exist_ok=True)
    ext = Path(cover_item.get_name()).suffix or ".jpg"
    dest_path = Path(dest_dir) / f"{uuid.uuid4().hex}{ext}"
    dest_path.write_bytes(cover_item.get_content())
    return str(dest_path)


def extract_chapters(path: str, max_chars: int = 20000) -> list[dict]:
    """按 spine 顺序抽取章节纯文本，chunk 太长时按字数切片，供检索使用"""
    chapters: list[dict] = []
    try:
        book = epub.read_epub(path, options={"ignore_ncx": True})
    except Exception:
        return chapters

    index = 0
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        try:
            soup = BeautifulSoup(item.get_content(), "lxml")
        except Exception:
            continue
        title_tag = soup.find(["h1", "h2", "h3", "title"])
        title = title_tag.get_text(strip=True) if title_tag else item.get_name()
        text = soup.get_text("\n", strip=True)
        if not text:
            continue
        for start in range(0, len(text), max_chars):
            chapters.append(
                {
                    "index": index,
                    "title": title,
                    "href": item.get_name(),
                    "text": text[start : start + max_chars],
                }
            )
            index += 1
    return chapters


def wrap_txt_as_epub(txt_path: str, dest_epub_path: str, title: str, author: str = "") -> bool:
    """把纯文本 TXT 按空行分段、按标题正则粗略分章，包装成标准 EPUB"""
    try:
        raw = Path(txt_path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return False

    chapter_pattern = re.compile(r"^\s*(第[0-9零一二三四五六七八九十百千]+[章节回]|Chapter\s+\d+)", re.M)
    splits = list(chapter_pattern.finditer(raw))

    book = epub.EpubBook()
    book.set_identifier(uuid.uuid4().hex)
    book.set_title(title or Path(txt_path).stem)
    book.set_language("zh")
    if author:
        book.add_author(author)

    chapters = []
    if splits:
        boundaries = [m.start() for m in splits] + [len(raw)]
        for i in range(len(splits)):
            heading = splits[i].group(1)
            body = raw[boundaries[i] : boundaries[i + 1]]
            chapters.append((heading, body))
    else:
        chapters.append((title or "正文", raw))

    epub_chapters = []
    for i, (heading, body) in enumerate(chapters):
        html_body = "".join(f"<p>{line}</p>" for line in body.splitlines() if line.strip())
        c = epub.EpubHtml(title=heading, file_name=f"chap_{i}.xhtml", lang="zh")
        c.content = f"<h2>{heading}</h2>{html_body}"
        book.add_item(c)
        epub_chapters.append(c)

    book.toc = tuple(epub_chapters)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav"] + epub_chapters

    try:
        Path(dest_epub_path).parent.mkdir(parents=True, exist_ok=True)
        epub.write_epub(dest_epub_path, book)
        return True
    except Exception:
        return False
