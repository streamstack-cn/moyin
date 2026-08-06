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
import threading
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

# 同一文件 hash 入库串行，避免上传与监控扫描并发插入两条书目
_ingest_lock_guard = threading.Lock()
_ingest_locks: dict[str, threading.Lock] = {}


def _lock_for_key(key: str) -> threading.Lock:
    with _ingest_lock_guard:
        lock = _ingest_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _ingest_locks[key] = lock
        return lock


def normalize_book_path(path: str) -> str:
    """统一成绝对路径字符串，避免 /Volumes/... 与 Volumes/... 被当成两本书。"""
    if not path:
        return ""
    raw = str(path).strip()
    try:
        from services.fs_browse import resolve_book_file_path

        remapped = resolve_book_file_path(raw)
        if remapped:
            return remapped
        p = Path(raw).expanduser()
        if p.exists():
            return str(p.resolve())
        # 尚不存在时也尽量绝对化
        return str(p if p.is_absolute() else (Path.cwd() / p).resolve())
    except OSError:
        return raw


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


def _find_existing_book(db: Session, *, file_hash: str, resolved_path: str) -> Optional[Book]:
    if file_hash:
        hit = db.query(Book).filter(Book.file_hash == file_hash).first()
        if hit:
            return hit
    if resolved_path:
        # 路径字符串可能有历史写法差异，尽量多匹配
        candidates = {resolved_path, resolved_path.lstrip("/")}
        hit = db.query(Book).filter(Book.file_path.in_(list(candidates))).first()
        if hit:
            return hit
        # 慢路径：规范化比对（书库通常几百本，可接受）
        for book in db.query(Book).filter(Book.file_path.isnot(None)).all():
            if normalize_book_path(book.file_path or "") == resolved_path:
                return book
    return None


def _rebind_existing_book(
    db: Session,
    existing: Book,
    *,
    resolved_path: str,
    library_id: Optional[str],
) -> Book:
    old = existing.file_path or ""
    old_norm = normalize_book_path(old) if old else ""
    if resolved_path and resolved_path != old and resolved_path != old_norm:
        old_missing = not old or not Path(old).exists()
        if old_missing or Path(resolved_path).exists():
            logger.info("检测到文件搬家，重绑路径 %s → %s", old, resolved_path)
            existing.file_path = resolved_path
            try:
                existing.file_size = Path(resolved_path).stat().st_size
            except OSError:
                pass
    elif resolved_path and old != resolved_path and Path(resolved_path).exists():
        # 仅规范化路径写法
        existing.file_path = resolved_path
    if library_id:
        existing.library_id = library_id
    db.commit()
    db.refresh(existing)
    return existing


async def ingest_file(
    db: Session,
    src_path: str,
    library_id: Optional[str] = None,
    original_filename: Optional[str] = None,
    auto_match: bool = True,
) -> Book:
    file_format = storage.book_format_from_name(original_filename or src_path)
    resolved_path = normalize_book_path(src_path)
    if not resolved_path or not Path(resolved_path).is_file():
        raise FileNotFoundError(f"文件不存在: {src_path}")

    file_hash = sha256_of_file(resolved_path)
    lock = _lock_for_key(file_hash or resolved_path)

    with lock:
        # 锁内再查一次，挡住上传与监控扫描的并发插入
        existing = _find_existing_book(db, file_hash=file_hash, resolved_path=resolved_path)
        if existing:
            logger.info("重复文件，复用已有书目: %s", resolved_path)
            return _rebind_existing_book(
                db, existing, resolved_path=resolved_path, library_id=library_id
            )

        from services.book_match import parse_book_title

        stem = Path(original_filename or resolved_path).stem
        parsed_name = parse_book_title(stem)
        title_guess = parsed_name.title or stem
        book = Book(
            library_id=library_id,
            file_path=resolved_path,
            file_hash=file_hash,
            file_format=file_format,
            file_size=Path(resolved_path).stat().st_size,
            title=title_guess,
        )
        if parsed_name.year and not book.pub_date:
            book.pub_date = parsed_name.year

        # 1) 转换（非 Web 原生格式）
        if convert_service.needs_conversion(file_format):
            dest = str(storage.CONVERTED_DIR / f"{file_hash}.epub")
            if convert_service.convert_to_epub(resolved_path, dest):
                book.converted_path = dest
        elif file_format == "txt":
            dest = str(storage.CONVERTED_DIR / f"{file_hash}.epub")
            if epub_service.wrap_txt_as_epub(resolved_path, dest, title_guess):
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
            embedded_meta = convert_service.extract_calibre_metadata(resolved_path)
        if not book.cover_path:
            cover = convert_service.extract_cover_with_calibre(resolved_path, str(storage.COVERS_DIR))
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

    # 3) 在线元数据自动匹配（豆瓣优先，Google Books 兜底）— 在锁外执行，避免长时间占用
    auto_enabled = db.query(AppConfig).filter_by(key="AUTO_MATCH_METADATA").first()
    if auto_match and (not auto_enabled or auto_enabled.value != "false"):
        try:
            online_meta = await metadata_service.auto_match(
                db,
                book.title,
                book.isbn or "",
                year=(book.pub_date or "")[:4],
                publisher=book.publisher or "",
                original_title=book.original_title or "",
            )
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


def dedupe_books_by_hash(db: Session) -> int:
    """合并同 hash 的重复书目：保留信息更完整的一条，只删库记录不删文件。"""
    from collections import defaultdict

    groups: dict[str, list[Book]] = defaultdict(list)
    for book in db.query(Book).filter(Book.file_hash.isnot(None), Book.file_hash != "").all():
        groups[book.file_hash].append(book)

    removed = 0
    for file_hash, books in groups.items():
        if len(books) < 2:
            continue

        def score(b: Book) -> tuple:
            return (
                1 if b.cover_path and Path(b.cover_path).is_file() else 0,
                1 if b.douban_id else 0,
                1 if b.description else 0,
                b.file_size or 0,
                b.added_at.timestamp() if b.added_at else 0,
            )

        books_sorted = sorted(books, key=score, reverse=True)
        keep = books_sorted[0]
        keep.file_path = normalize_book_path(keep.file_path or "") or keep.file_path
        for dup in books_sorted[1:]:
            logger.info("合并重复书目 hash=%s keep=%s drop=%s", file_hash[:12], keep.id, dup.id)
            db.delete(dup)
            removed += 1
    if removed:
        db.commit()
    return removed


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


def _sidecar_candidates(book: Book) -> list[tuple[Path, str]]:
    """收集待清理的封面/转换副本路径。

    除库内记录的路径外，始终尝试 `converted/{file_hash}.epub`：
    路径迁移或 converted_path 未写入时，避免留下孤儿转换文件。
    """
    candidates: list[tuple[Path, str]] = []
    seen: set[str] = set()

    def add(path: Path | None, kind: str) -> None:
        if path is None:
            return
        key = str(path)
        if key in seen:
            return
        seen.add(key)
        candidates.append((path, kind))

    for raw, kind in ((book.cover_path, "cover"), (book.converted_path, "converted")):
        if not raw:
            continue
        resolved = storage.resolve_stored_path(raw)
        if resolved is not None:
            add(resolved, kind)
        add(Path(str(raw)), kind)

    file_hash = (getattr(book, "file_hash", None) or "").strip()
    if file_hash:
        add(storage.CONVERTED_DIR / f"{file_hash}.epub", "converted")

    return candidates


def _unlink_sidecar(path: Path, kind: str) -> tuple[str | None, str | None]:
    """若文件位于 covers/converted 目录内则删除。

    返回 (deleted_path, error)；两者可同时为 None（文件不存在或越界跳过）。
    """
    allowed = [storage.COVERS_DIR.resolve(), storage.CONVERTED_DIR.resolve()]
    try:
        resolved = path.expanduser().resolve()
        if not resolved.is_file():
            return None, None
        if not any(resolved.is_relative_to(root) for root in allowed):
            return None, None
        resolved.unlink(missing_ok=True)
        return str(resolved), None
    except (OSError, ValueError) as e:
        return None, str(e)


def _cleanup_book_sidecar_files(book: Book) -> None:
    """删除书籍关联的封面/转换副本（仅限本应用 data 目录下的派生文件）。"""
    for path, kind in _sidecar_candidates(book):
        _unlink_sidecar(path, kind)


def purge_orphan_converted_files(db: Session) -> int:
    """删除 converted/ 中已无对应书目的转换副本，保持磁盘与库一致。"""
    hashes = {
        (h or "").strip()
        for (h,) in db.query(Book.file_hash).all()
        if (h or "").strip()
    }
    removed = 0
    try:
        entries = list(storage.CONVERTED_DIR.glob("*.epub"))
    except OSError:
        return 0
    for path in entries:
        if path.stem in hashes:
            continue
        try:
            if path.is_file():
                path.unlink()
                removed += 1
                logger.info("删除孤儿转换副本: %s", path.name)
        except OSError as e:
            logger.warning("无法删除孤儿转换副本 %s: %s", path, e)
    return removed


def delete_book_files(book: Book) -> dict:
    """物理删除原书文件 + 封面/转换副本。

    返回 {"deleted": [...], "failed": [{"path": ..., "error": ...}, ...]}。
    原文件删除失败时仍会尽量清理派生文件，由调用方决定是否继续删库记录。
    """
    deleted: list[str] = []
    failed: list[dict] = []

    # 先清派生文件（即使原文件删失败也不留孤儿封面/转换副本）
    for path, kind in _sidecar_candidates(book):
        removed, err = _unlink_sidecar(path, kind)
        if removed:
            deleted.append(removed)
        elif err:
            failed.append({"path": str(path), "error": err, "kind": kind})

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

    # 先清同 hash 重复书目，避免历史上传+监控竞态留下的双份
    try:
        n_dup = dedupe_books_by_hash(db)
        if n_dup:
            logger.info("扫描前合并重复书目 %s 条", n_dup)
    except Exception:  # noqa: BLE001
        logger.exception("合并重复书目失败")

    books = db.query(Book).filter(Book.library_id == library.id).all()
    existing_paths = {
        normalize_book_path(b.file_path) for b in books if b.file_path
    }
    existing_paths.discard("")
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
        path_str = normalize_book_path(str(file_path))
        if not path_str:
            continue
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
            elif prior_path and normalize_book_path(book.file_path or "") != normalize_book_path(
                prior_path
            ):
                rebound += 1
            else:
                skipped += 1
            existing_paths.add(normalize_book_path(book.file_path or ""))
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

    # 再扫一遍：库内仍指向失效路径的书，先按挂载根重绑，再按 hash 找回；仍失败则删除记录
    from services.fs_browse import resolve_book_file_path

    books = db.query(Book).filter(Book.library_id == library.id).all()
    orphan_books = []
    claimed: set[str] = set()
    for b in books:
        if not b.file_path:
            continue
        resolved = resolve_book_file_path(b.file_path)
        if resolved:
            if resolved != b.file_path:
                logger.info("扫描路径自愈 %s → %s", b.file_path, resolved)
                b.file_path = resolved
                rebound += 1
            claimed.add(resolved)
            continue
        orphan_books.append(b)
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
            n = purge_orphan_converted_files(db)
            if n:
                logger.info("清理孤儿转换副本 %s 个", n)
        except Exception:  # noqa: BLE001
            pass
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
    """未归架上传：落到 uploads/{hash}.{ext}。"""
    return place_uploaded_file(tmp_path, filename, library_root=None)


def unique_dest_in_dir(directory: Path, filename: str) -> Path:
    """在目录内生成不覆盖已有文件的目标路径。"""
    directory.mkdir(parents=True, exist_ok=True)
    name = Path(filename).name
    if not name or name in (".", ".."):
        name = f"book-{uuid.uuid4().hex[:8]}"
    dest = directory / name
    if not dest.exists():
        return dest
    stem = Path(name).stem or "book"
    suffix = Path(name).suffix
    for i in range(1, 1000):
        candidate = directory / f"{stem}-{i}{suffix}"
        if not candidate.exists():
            return candidate
    return directory / f"{stem}-{uuid.uuid4().hex[:8]}{suffix}"


def _safe_move(src: Path, dest: Path) -> None:
    """同盘 rename，跨盘则 copy + 校验后删源。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.resolve() == dest.resolve():
        return
    try:
        src.replace(dest)
        return
    except OSError:
        pass
    shutil.copy2(src, dest)
    try:
        if src.stat().st_size != dest.stat().st_size:
            dest.unlink(missing_ok=True)
            raise OSError("复制后文件大小不一致")
    except OSError:
        dest.unlink(missing_ok=True)
        raise
    src.unlink(missing_ok=True)


def place_uploaded_file(
    tmp_path: str,
    filename: str,
    library_root: Optional[str] = None,
) -> str:
    """将上传临时文件落到目标位置。

    - library_root 有值：写入该书库目录，尽量保留原始文件名
    - 否则：写入 uploads/{hash}.{ext}（未归架）
    """
    src = Path(tmp_path)
    if not src.is_file():
        raise FileNotFoundError(f"上传临时文件不存在: {tmp_path}")

    file_format = storage.book_format_from_name(filename) or storage.book_format_from_name(str(src))
    if library_root:
        root = Path(library_root).expanduser()
        if not root.exists():
            raise FileNotFoundError(f"书库目录不存在: {library_root}")
        if not root.is_dir():
            raise NotADirectoryError(f"书库路径不是目录: {library_root}")
        preferred = Path(filename).name if filename else f"book.{file_format or 'bin'}"
        if not Path(preferred).suffix and file_format:
            preferred = f"{preferred}.{file_format}"
        dest = unique_dest_in_dir(root, preferred)
        shutil.copyfile(src, dest)
        return str(dest.resolve())

    file_hash = sha256_of_file(str(src))
    ext = file_format or "bin"
    dest = storage.UPLOAD_DIR / f"{file_hash}.{ext}"
    storage.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        shutil.copyfile(src, dest)
    return str(dest.resolve())


def transfer_book_file(book: Book, library: Optional[Library] = None) -> dict:
    """将书籍原文件转移到目标书架目录，或收回未归架（uploads/）。

    更新 book.file_path / book.library_id（调用方负责 commit）。
    返回 {"file_path", "library_id", "moved"}。
    """
    src = Path(book.file_path or "").expanduser()
    if not src.is_file():
        raise FileNotFoundError(f"原文件不存在: {book.file_path}")

    file_format = (book.file_format or storage.book_format_from_name(str(src)) or "bin").lower()
    file_hash = (book.file_hash or "").strip() or sha256_of_file(str(src))

    if library is not None:
        root = Path(library.root_path).expanduser()
        if not root.exists() or not root.is_dir():
            raise FileNotFoundError(f"目标书库目录不可用: {library.root_path}")
        # 已在目标树内：只改归属
        try:
            if src.resolve().is_relative_to(root.resolve()):
                book.library_id = library.id
                return {
                    "file_path": str(src.resolve()),
                    "library_id": library.id,
                    "moved": False,
                }
        except (OSError, ValueError):
            pass
        preferred = src.name
        # uploads 下哈希文件名可读性差，尽量用书名
        if src.parent.resolve() == storage.UPLOAD_DIR.resolve() or (
            len(Path(preferred).stem) >= 32 and Path(preferred).stem.replace("-", "").isalnum()
        ):
            title = (book.title or "book").strip() or "book"
            safe = "".join(ch if ch not in '\\/:*?"<>|' else "_" for ch in title).strip(" .") or "book"
            preferred = f"{safe[:80]}.{file_format}"
        dest = unique_dest_in_dir(root, preferred)
        _safe_move(src, dest)
        book.file_path = str(dest.resolve())
        book.library_id = library.id
        try:
            book.file_size = dest.stat().st_size
        except OSError:
            pass
        return {"file_path": book.file_path, "library_id": library.id, "moved": True}

    # → 未归架
    storage.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = storage.UPLOAD_DIR / f"{file_hash}.{file_format}"
    try:
        if src.resolve() == dest.resolve():
            book.library_id = None
            return {"file_path": str(src.resolve()), "library_id": None, "moved": False}
    except OSError:
        pass
    if dest.exists() and src.resolve() != dest.resolve():
        # 目标已有同 hash 文件：删源即可（内容相同）
        try:
            if sha256_of_file(str(src)) == file_hash:
                src.unlink(missing_ok=True)
                book.file_path = str(dest.resolve())
                book.library_id = None
                return {"file_path": book.file_path, "library_id": None, "moved": True}
        except OSError:
            pass
        dest = unique_dest_in_dir(storage.UPLOAD_DIR, f"{file_hash}.{file_format}")
    _safe_move(src, dest)
    book.file_path = str(dest.resolve())
    book.library_id = None
    try:
        book.file_size = dest.stat().st_size
    except OSError:
        pass
    return {"file_path": book.file_path, "library_id": None, "moved": True}
