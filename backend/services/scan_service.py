"""
scan_service.py — 电子书导入流水线

统一处理「网页上传」与「目录扫描」两种入库路径：
1. 计算文件 hash 去重
2. 识别格式，非 Web 原生格式调用 calibre 转换出可阅读的 EPUB 副本
3. 抽取内嵌元数据 / 封面，写入书籍记录
4. 若开启豆瓣/Google 自动匹配，尝试补全在线元数据
5. 对可阅读的 EPUB 抽取章节纯文本，写入 book_content_chunks 供全文检索
"""

import hashlib
import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy.orm import Session

import storage
from models import AppConfig, Book, BookContentChunk, Library
from services import convert_service, epub_service, metadata_service

logger = logging.getLogger("moyin.scan")

SUPPORTED_FORMATS = {
    "epub", "txt", "pdf", "mobi", "azw3", "azw", "fb2", "cbz", "cbr",
}


def sha256_of_file(path: str, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _readable_epub_path(book: Book) -> Optional[str]:
    if book.file_format in convert_service.NATIVE_READABLE:
        return book.file_path
    if book.converted_path and Path(book.converted_path).exists():
        return book.converted_path
    return None


def _indexable_epub_path(book: Book) -> Optional[str]:
    """可用于章节全文索引的 EPUB 路径：原生 epub，或任意格式的转换/封装产物。"""
    if book.file_format == "epub" and book.file_path and Path(book.file_path).exists():
        return book.file_path
    if book.converted_path and Path(book.converted_path).exists():
        return book.converted_path
    return None


def _index_content(db: Session, book: Book) -> None:
    epub_path = _indexable_epub_path(book)
    if not epub_path:
        return
    db.query(BookContentChunk).filter(BookContentChunk.book_id == book.id).delete()
    for chapter in epub_service.extract_chapters(epub_path):
        db.add(
            BookContentChunk(
                book_id=book.id,
                chapter_index=chapter["index"],
                chapter_title=chapter["title"],
                cfi_anchor=chapter["href"],
                text=chapter["text"],
            )
        )
    db.commit()


async def ingest_file(
    db: Session,
    src_path: str,
    library_id: Optional[str] = None,
    original_filename: Optional[str] = None,
    auto_match: bool = True,
) -> Book:
    file_format = storage.book_format_from_name(original_filename or src_path)
    file_hash = sha256_of_file(src_path)

    existing = db.query(Book).filter(Book.file_hash == file_hash).first()
    if existing:
        # 同内容文件搬家/改名：更新路径，避免旧路径失效后无法打开
        src = str(Path(src_path).resolve()) if Path(src_path).exists() else src_path
        old = existing.file_path or ""
        if src and src != old:
            old_missing = not old or not Path(old).exists()
            if old_missing or Path(src).exists():
                logger.info("检测到文件搬家，重绑路径 %s → %s", old, src)
                existing.file_path = src
                try:
                    existing.file_size = Path(src).stat().st_size
                except OSError:
                    pass
                if library_id and not existing.library_id:
                    existing.library_id = library_id
                elif library_id:
                    existing.library_id = library_id
                db.commit()
                db.refresh(existing)
        else:
            logger.info("重复文件，跳过入库: %s", src_path)
        return existing

    title_guess = Path(original_filename or src_path).stem
    book = Book(
        library_id=library_id,
        file_path=src_path,
        file_hash=file_hash,
        file_format=file_format,
        file_size=Path(src_path).stat().st_size,
        title=title_guess,
    )

    # 1) 转换（非 Web 原生格式）
    if convert_service.needs_conversion(file_format):
        dest = str(storage.CONVERTED_DIR / f"{file_hash}.epub")
        if convert_service.convert_to_epub(src_path, dest):
            book.converted_path = dest
    elif file_format == "txt":
        dest = str(storage.CONVERTED_DIR / f"{file_hash}.epub")
        if epub_service.wrap_txt_as_epub(src_path, dest, title_guess):
            book.converted_path = dest

    # 2) 内嵌元数据 / 封面
    embedded_meta: dict = {}
    epub_path = book.file_path if file_format == "epub" else book.converted_path
    if epub_path and Path(epub_path).exists():
        embedded_meta = epub_service.extract_epub_metadata(epub_path)
        cover = epub_service.extract_epub_cover(epub_path, str(storage.COVERS_DIR))
        if cover:
            book.cover_path = cover
    if not embedded_meta:
        embedded_meta = convert_service.extract_calibre_metadata(src_path)
    # PDF / MOBI 等：优先用 Calibre 抽封面（PDF 没有 epub 封面页时尤其重要）
    if not book.cover_path:
        cover = convert_service.extract_cover_with_calibre(src_path, str(storage.COVERS_DIR))
        if cover:
            book.cover_path = cover

    if embedded_meta.get("title"):
        book.title = embedded_meta["title"]
    if embedded_meta.get("authors"):
        book.authors = json.dumps(embedded_meta["authors"], ensure_ascii=False)
    book.publisher = embedded_meta.get("publisher", "") or book.publisher
    book.pub_date = embedded_meta.get("pub_date", "") or book.pub_date
    book.isbn = embedded_meta.get("isbn", "") or book.isbn
    book.language = embedded_meta.get("language", "zh") or "zh"
    book.description = embedded_meta.get("description", "") or book.description
    book.metadata_source = "embedded" if embedded_meta else "manual"

    db.add(book)
    db.commit()
    db.refresh(book)

    # 3) 在线元数据自动匹配（豆瓣优先，Google Books 兜底）
    auto_enabled = db.query(AppConfig).filter_by(key="AUTO_MATCH_METADATA").first()
    if auto_match and (not auto_enabled or auto_enabled.value != "false"):
        try:
            online_meta = await metadata_service.auto_match(db, book.title, book.isbn)
            if online_meta:
                await apply_metadata(book, online_meta, db=db)
                db.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning("自动匹配元数据失败: %s", e)

    # 4) 全文索引
    try:
        _index_content(db, book)
    except Exception as e:  # noqa: BLE001
        logger.warning("章节索引失败: %s", e)

    return book


async def _download_cover_image(url: str) -> Optional[str]:
    """下载豆瓣/Google Books 返回的封面图，落盘到 COVERS_DIR。
    豆瓣 CDN 对无 Referer 请求返回 418，必须带 book.douban.com Referer。"""
    if not url:
        return None
    # 候选列表里可能已是本站代理地址，还原真实外链再下载
    if url.startswith("/api/meta/cover"):
        from urllib.parse import parse_qs, urlparse

        qs = parse_qs(urlparse(url).query)
        url = (qs.get("url") or [""])[0]
        if not url:
            return None
    if url.startswith("//"):
        url = "https:" + url
    # 优先尝试大图
    candidates = [url]
    for small, large in (
        ("/view/subject/s/", "/view/subject/l/"),
        ("/subject/s/public/", "/subject/l/public/"),
        ("/view/subject/m/", "/view/subject/l/"),
    ):
        if small in url:
            candidates.insert(0, url.replace(small, large))
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": "https://book.douban.com/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    content = b""
    used = url
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for candidate in candidates:
                try:
                    resp = await client.get(candidate, headers=headers)
                    ctype = (resp.headers.get("content-type") or "").lower()
                    if (
                        resp.status_code == 200
                        and resp.content
                        and len(resp.content) > 200
                        and "image" in ctype
                    ):
                        content = resp.content
                        used = candidate
                        break
                    # 偶发 CDN 不带 content-type，按体积兜底
                    if resp.status_code == 200 and resp.content and len(resp.content) > 2000 and not ctype.startswith("text/"):
                        content = resp.content
                        used = candidate
                        break
                except Exception:
                    continue
    except Exception as exc:  # noqa: BLE001
        logger.warning("封面下载异常 url=%s err=%s", url, exc)
        return None
    if not content:
        logger.warning("封面下载失败（无有效内容）url=%s", url)
        return None
    ext = Path(used.split("?")[0]).suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    dest = storage.COVERS_DIR / f"{uuid.uuid4().hex}{ext}"
    dest.write_bytes(content)
    return str(dest)


def _apply_categories_as_tags(db: Session, book: Book, categories: list) -> None:
    """把豆瓣/Google 返回的分类标签写入 book_tags（source=auto）。"""
    from models import BookTag, Tag

    names = [str(c).strip() for c in (categories or []) if str(c).strip()]
    if not names:
        return
    for name in names[:12]:
        tag = db.query(Tag).filter_by(name=name).first()
        if not tag:
            tag = Tag(name=name, source="auto")
            db.add(tag)
            db.flush()
        exists = db.query(BookTag).filter_by(book_id=book.id, tag_id=tag.id).first()
        if not exists:
            db.add(BookTag(book_id=book.id, tag_id=tag.id))


async def apply_metadata(book: Book, meta: dict, db: Optional[Session] = None) -> dict:
    if book.metadata_locked:
        return {"cover_updated": False, "had_cover_url": bool(meta.get("cover_url"))}
    book.title = meta.get("title") or book.title
    book.subtitle = meta.get("subtitle", book.subtitle)
    book.original_title = meta.get("original_title", book.original_title)
    if meta.get("authors"):
        book.authors = json.dumps(meta["authors"], ensure_ascii=False)
    book.translator = meta.get("translator", book.translator)
    book.publisher = meta.get("publisher") or book.publisher
    # 出版地：优先用元数据；若为空且有出版社，再做一次推断兜底
    pub_place = meta.get("pub_place") or ""
    if not pub_place and meta.get("publisher"):
        from services.douban_service import infer_pub_place

        pub_place = infer_pub_place(meta["publisher"])
    if pub_place:
        book.pub_place = pub_place
    if meta.get("pub_date"):
        from services.citation_service import format_pub_date_zh

        book.pub_date = format_pub_date_zh(meta["pub_date"]) or meta["pub_date"]
    book.isbn = meta.get("isbn") or book.isbn
    book.series = meta.get("series", book.series)
    book.page_count = meta.get("page_count") or book.page_count
    book.language = meta.get("language") or book.language
    book.description = meta.get("description") or book.description
    if meta.get("catalog"):
        book.catalog = meta["catalog"]
    if meta.get("producer"):
        book.producer = meta["producer"]
    if meta.get("price"):
        book.price = meta["price"]
    if meta.get("binding"):
        book.binding = meta["binding"]
    book.douban_id = meta.get("douban_id", book.douban_id)
    book.google_books_id = meta.get("google_books_id", book.google_books_id)
    book.rating = meta.get("rating") or book.rating
    book.metadata_source = meta.get("source", book.metadata_source)

    cover_url = meta.get("cover_url")
    cover_updated = False
    if cover_url:
        new_cover = await _download_cover_image(cover_url)
        if new_cover:
            old_cover = book.cover_path
            book.cover_path = new_cover
            cover_updated = True
            if old_cover and old_cover != new_cover and Path(old_cover).exists():
                try:
                    Path(old_cover).unlink()
                except OSError:
                    pass
        else:
            logger.warning(
                "匹配元数据后封面未更新 book=%s title=%s cover_url=%s",
                book.id,
                book.title,
                cover_url,
            )

    if db is not None and meta.get("categories"):
        _apply_categories_as_tags(db, book, meta.get("categories") or [])

    return {"cover_updated": cover_updated, "had_cover_url": bool(cover_url)}


def _cleanup_book_sidecar_files(book: Book) -> None:
    """删除书籍关联的封面/转换副本（仅限本应用 data 目录下的派生文件）。"""
    allowed_roots = [storage.COVERS_DIR.resolve(), storage.CONVERTED_DIR.resolve()]
    for raw in (book.cover_path, book.converted_path):
        if not raw:
            continue
        try:
            path = Path(raw).resolve()
            if not path.is_file():
                continue
            if any(path.is_relative_to(root) for root in allowed_roots):
                path.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass


def delete_book_files(book: Book) -> dict:
    """物理删除原书文件 + 封面/转换副本。

    返回 {"deleted": [...], "failed": [{"path": ..., "error": ...}, ...]}。
    原文件删除失败时仍会尽量清理派生文件，由调用方决定是否继续删库记录。
    """
    deleted: list[str] = []
    failed: list[dict] = []

    # 先清派生文件（即使原文件删失败也不留孤儿封面）
    for raw, kind in ((book.cover_path, "cover"), (book.converted_path, "converted")):
        if not raw:
            continue
        try:
            path = Path(raw).resolve()
            if not path.is_file():
                continue
            allowed = [storage.COVERS_DIR.resolve(), storage.CONVERTED_DIR.resolve()]
            if any(path.is_relative_to(root) for root in allowed):
                path.unlink(missing_ok=True)
                deleted.append(str(path))
        except (OSError, ValueError) as e:
            failed.append({"path": raw, "error": str(e), "kind": kind})

    if book.file_path:
        try:
            path = Path(book.file_path).expanduser().resolve()
            if path.is_file():
                path.unlink()
                deleted.append(str(path))
            elif path.exists():
                failed.append({"path": str(path), "error": "路径不是普通文件，已跳过", "kind": "original"})
        except OSError as e:
            logger.warning("无法删除原文件 %s: %s", book.file_path, e)
            failed.append({"path": book.file_path, "error": str(e), "kind": "original"})

    return {"deleted": deleted, "failed": failed}


async def scan_library(db: Session, library: Library, cancel_check=None) -> dict:
    """
    扫描书库目录：
    - 新文件入库
    - 已存在路径跳过
    - 同 hash 搬家文件自动重绑路径
    - 目录中已删除且无法按指纹找回的书：从书库移除记录
    - cancel_check() 为 True 时尽快中止（已入库的会保留）
    """
    root = Path(library.root_path)
    if not root.exists():
        return {"success": False, "detail": f"目录不存在: {library.root_path}"}

    disk_files: list[Path] = []
    for file_path in root.rglob("*"):
        if cancel_check and cancel_check():
            logger.info("扫描在枚举阶段被取消: %s", library.name)
            return {
                "success": True,
                "cancelled": True,
                "added": 0,
                "skipped": 0,
                "rebound": 0,
                "removed": 0,
            }
        if not file_path.is_file():
            continue
        fmt = file_path.suffix.lstrip(".").lower()
        if fmt not in SUPPORTED_FORMATS:
            continue
        disk_files.append(file_path)

    books = db.query(Book).filter(Book.library_id == library.id).all()
    existing_paths = {b.file_path for b in books if b.file_path}
    added = 0
    skipped = 0
    rebound = 0
    removed = 0
    cancelled = False

    for file_path in disk_files:
        if cancel_check and cancel_check():
            cancelled = True
            logger.info("扫描在导入阶段被取消: %s（已入库 %s 本）", library.name, added)
            break
        path_str = str(file_path)
        if path_str in existing_paths:
            skipped += 1
            continue
        try:
            file_hash = sha256_of_file(path_str)
            prior = db.query(Book).filter(Book.file_hash == file_hash).first()
            prior_path = prior.file_path if prior else None
            # 目录扫描关闭自动匹配豆瓣，避免扫库时大量网络请求拖死整站
            book = await ingest_file(
                db,
                path_str,
                library_id=library.id,
                original_filename=file_path.name,
                auto_match=False,
            )
            if prior is None:
                added += 1
            elif prior_path and book.file_path != prior_path:
                rebound += 1
            else:
                skipped += 1
            existing_paths.add(book.file_path)
        except Exception as e:  # noqa: BLE001
            logger.error("导入失败 %s: %s", file_path, e)

    if cancelled:
        db.commit()
        return {
            "success": True,
            "cancelled": True,
            "added": added,
            "skipped": skipped,
            "rebound": rebound,
            "removed": 0,
        }

    # 再扫一遍：库内仍指向失效路径的书，按 hash 在目录中找回；找回失败则删除记录
    books = db.query(Book).filter(Book.library_id == library.id).all()
    orphan_books = [b for b in books if b.file_path and not Path(b.file_path).exists()]
    claimed = {b.file_path for b in books if b.file_path and Path(b.file_path).exists()}
    hash_index: dict[str, str] = {}
    if orphan_books:
        for file_path in disk_files:
            if cancel_check and cancel_check():
                cancelled = True
                break
            path_str = str(file_path)
            if path_str in claimed:
                continue
            try:
                hash_index[sha256_of_file(path_str)] = path_str
            except OSError:
                continue

    if cancelled:
        db.commit()
        return {
            "success": True,
            "cancelled": True,
            "added": added,
            "skipped": skipped,
            "rebound": rebound,
            "removed": 0,
        }

    to_delete: list[Book] = []
    for book in orphan_books:
        new_path = hash_index.get(book.file_hash or "")
        if new_path:
            logger.info("孤儿重绑 %s → %s", book.file_path, new_path)
            book.file_path = new_path
            try:
                book.file_size = Path(new_path).stat().st_size
            except OSError:
                pass
            rebound += 1
            claimed.add(new_path)
            continue
        to_delete.append(book)

    for book in to_delete:
        logger.info("目录已无此文件，移除书目: %s (%s)", book.title, book.file_path)
        _cleanup_book_sidecar_files(book)
        db.delete(book)
        removed += 1

    if to_delete:
        db.flush()
        try:
            from api_books import _cleanup_orphan_tags

            _cleanup_orphan_tags(db)
        except Exception:  # noqa: BLE001
            pass

    from datetime import datetime

    library.last_scanned_at = datetime.utcnow()
    db.commit()
    logger.info(
        "书库扫描完成 %s: added=%s skipped=%s rebound=%s removed=%s",
        library.name,
        added,
        skipped,
        rebound,
        removed,
    )
    return {
        "success": True,
        "added": added,
        "skipped": skipped,
        "rebound": rebound,
        "removed": removed,
    }


def copy_upload_to_storage(tmp_path: str, filename: str) -> str:
    file_format = storage.book_format_from_name(filename)
    file_hash = sha256_of_file(tmp_path)
    dest = storage.UPLOAD_DIR / f"{file_hash}.{file_format}"
    if not dest.exists():
        shutil.copyfile(tmp_path, dest)
    return str(dest)
