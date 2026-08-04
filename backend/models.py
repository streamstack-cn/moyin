"""
models.py — SQLAlchemy ORM 模型定义

覆盖：用户体系、书库/书籍、标签/书架、阅读进度、高亮笔记、
引用篮/写作项目、书内正文分片（用于全文检索）、系统配置。
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


def gen_id() -> str:
    return uuid.uuid4().hex


# ── 用户体系 ──────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(String(32), primary_key=True, default=gen_id)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(64), default="")
    role = Column(String(16), default="reader")  # admin / reader
    disabled = Column(Boolean, default=False)
    created_by = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)
    # 账号级个人偏好（JSON 字符串）：深色/浅色模式、阅读器背景与高亮配色、字号等。
    # 每个用户独立存储、随账号登录同步，避免多用户共用一台设备/浏览器时互相覆盖对方的界面设置。
    preferences = Column(Text, default="{}")


# ── 书库 ─────────────────────────────────────────────────────────────────
class Library(Base):
    __tablename__ = "libraries"

    id = Column(String(32), primary_key=True, default=gen_id)
    name = Column(String(128), nullable=False)
    root_path = Column(String(512), nullable=False)
    scan_mode = Column(String(16), default="manual")  # manual / watch
    order_index = Column(Integer, default=0)  # 书架自定义排序（拖拽调整）
    created_at = Column(DateTime, default=datetime.utcnow)
    last_scanned_at = Column(DateTime, nullable=True)

    books = relationship("Book", back_populates="library", cascade="all, delete-orphan")


# ── 标签 / 书架 ────────────────────────────────────────────────────────────
class Tag(Base):
    __tablename__ = "tags"

    id = Column(String(32), primary_key=True, default=gen_id)
    name = Column(String(64), unique=True, nullable=False)
    source = Column(String(16), default="manual")  # manual / auto
    created_at = Column(DateTime, default=datetime.utcnow)


class BookTag(Base):
    __tablename__ = "book_tags"

    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(String(32), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class Collection(Base):
    """书架 / 合集，可手动归类，也可作为智能筛选保存视图使用"""

    __tablename__ = "collections"

    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    name = Column(String(128), nullable=False)
    is_smart = Column(Boolean, default=False)
    smart_query = Column(Text, default="")  # 简单 JSON 条件，如 {"status":"reading"}
    created_at = Column(DateTime, default=datetime.utcnow)


class CollectionBook(Base):
    __tablename__ = "collection_books"

    collection_id = Column(String(32), ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True)
    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"), primary_key=True)
    order_index = Column(Integer, default=0)


# ── 书籍 ─────────────────────────────────────────────────────────────────
class Book(Base):
    __tablename__ = "books"

    id = Column(String(32), primary_key=True, default=gen_id)
    library_id = Column(String(32), ForeignKey("libraries.id", ondelete="SET NULL"), nullable=True)

    file_path = Column(String(1024), nullable=False)
    converted_path = Column(String(1024), nullable=True)  # calibre 转换后的 epub 路径（若原格式不可直接阅读）
    file_hash = Column(String(64), index=True, nullable=True)
    file_format = Column(String(16), nullable=False)  # epub/pdf/mobi/azw3/txt/fb2/cbz/cbr
    file_size = Column(Integer, default=0)

    title = Column(String(512), nullable=False, default="未命名书籍")
    subtitle = Column(String(512), default="")
    original_title = Column(String(512), default="")
    authors = Column(Text, default="")  # JSON 数组字符串
    translator = Column(String(256), default="")
    publisher = Column(String(256), default="")
    pub_place = Column(String(128), default="")
    pub_date = Column(String(32), default="")
    isbn = Column(String(32), default="", index=True)
    series = Column(String(256), default="")
    page_count = Column(Integer, default=0)
    language = Column(String(16), default="zh")
    description = Column(Text, default="")
    # 豆瓣扩展：目录 / 出品方 / 定价 / 装帧
    catalog = Column(Text, default="")
    producer = Column(String(256), default="")
    price = Column(String(64), default="")
    binding = Column(String(64), default="")
    cover_path = Column(String(1024), default="")

    douban_id = Column(String(32), default="")
    google_books_id = Column(String(64), default="")
    rating = Column(Float, default=0.0)
    metadata_source = Column(String(16), default="manual")  # douban/google/manual
    metadata_locked = Column(Boolean, default=False)  # 手动编辑后锁定，自动刷新时不覆盖

    added_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    library = relationship("Library", back_populates="books")


class BookContentChunk(Base):
    """书内正文分片（按章节切分），用于本书内 / 跨书全文检索"""

    __tablename__ = "book_content_chunks"

    id = Column(String(32), primary_key=True, default=gen_id)
    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"), index=True)
    chapter_index = Column(Integer, default=0)
    chapter_title = Column(String(512), default="")
    cfi_anchor = Column(String(512), default="")  # epub.js 章节起始 CFI / href
    text = Column(Text, default="")


# ── 阅读进度 ────────────────────────────────────────────────────────────
class ReadingProgress(Base):
    __tablename__ = "reading_progress"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_progress_user_book"),)

    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"))
    location = Column(String(512), default="")  # epub CFI / pdf page
    percent = Column(Float, default=0.0)
    status = Column(String(16), default="unread")  # unread/reading/finished
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── 用户收藏（特别好的书 / 待看）────────────────────────────────────────
class UserFavorite(Base):
    __tablename__ = "user_favorites"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_favorite_user_book"),)

    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ── 高亮 / 笔记 ────────────────────────────────────────────────────────────
class Highlight(Base):
    __tablename__ = "highlights"

    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"), index=True)

    cfi_range = Column(String(512), nullable=False)
    color = Column(String(16), default="#ffd54f")
    quoted_text = Column(Text, default="")
    note = Column(Text, default="")
    chapter_title = Column(String(512), default="")
    page_no = Column(String(16), default="")  # 若能推算出对应纸质页码/位置百分比

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── 引用篮 / 写作项目 ───────────────────────────────────────────────────────
class CitationProject(Base):
    __tablename__ = "citation_projects"

    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    name = Column(String(128), nullable=False, default="默认引用篮")
    script_variant = Column(String(8), default="simplified")  # simplified / traditional
    created_at = Column(DateTime, default=datetime.utcnow)


class CitationBasketItem(Base):
    __tablename__ = "citation_basket_items"

    id = Column(String(32), primary_key=True, default=gen_id)
    project_id = Column(String(32), ForeignKey("citation_projects.id", ondelete="CASCADE"), index=True)
    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"))
    highlight_id = Column(String(32), ForeignKey("highlights.id", ondelete="SET NULL"), nullable=True)

    quoted_text = Column(Text, default="")
    page_no = Column(String(16), default="")
    cfi_range = Column(String(512), default="")  # 书内定位：EPUB CFI 或 pdf:#page=…
    group_name = Column(String(128), default="")  # 分组名（如"关于勇气的引用"），空字符串表示未分组
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


# ── 读书笔记（Markdown，边读边写）────────────────────────────────────────
class BookNote(Base):
    """每位用户对每本书维护一份 Markdown 笔记，随阅读进度持续补充"""

    __tablename__ = "book_notes"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_note_user_book"),)

    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"))
    book_id = Column(String(32), ForeignKey("books.id", ondelete="CASCADE"), index=True)
    content = Column(Text, default="")  # Markdown 原文
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── 豆瓣同步的想读/在读/读过状态（可选个性化记录，来自 obsidian-douban 思路）──
class DoubanSyncRecord(Base):
    __tablename__ = "douban_sync_records"

    id = Column(String(32), primary_key=True, default=gen_id)
    douban_id = Column(String(32), index=True)
    title = Column(String(512), default="")
    status = Column(String(16), default="wish")  # wish/reading/done
    matched_book_id = Column(String(32), ForeignKey("books.id", ondelete="SET NULL"), nullable=True)
    synced_at = Column(DateTime, default=datetime.utcnow)


# ── 系统配置 ────────────────────────────────────────────────────────────
class AppConfig(Base):
    __tablename__ = "app_config"

    key = Column(String(64), primary_key=True)
    value = Column(Text, default="")


# ── AI 伴读：用户独立 AI 配置 ────────────────────────────────────────────
class UserAiConfig(Base):
    """每位用户独立的 AI 服务配置，互相隔离，管理员不可跨用户查看。"""
    __tablename__ = "user_ai_configs"

    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    base_url = Column(Text, default="https://api.siliconflow.cn/v1")
    api_key = Column(Text, default="")   # 明文存储，本地 SQLite 用户数据
    model = Column(String(128), default="Qwen/Qwen3-8B")
    # 用户 AI 画像（JSON）：阅读风格、关注领域、输出语气、自定义要求
    ai_portrait = Column(Text, default="{}")
    output_lang = Column(String(8), default="zh")       # zh / zh-tw
    output_length = Column(String(16), default="standard")  # concise / standard / detailed
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── AI 伴读：报告缓存 ──────────────────────────────────────────────────────
class AiReadingReport(Base):
    """AI 伴读报告，按用户 + 书目组合存储，支持多书联读。"""
    __tablename__ = "ai_reading_reports"

    id = Column(String(32), primary_key=True, default=gen_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    book_ids = Column(Text, default="[]")       # JSON 数组，如 ["id1","id2"]
    book_ids_hash = Column(String(64), index=True)   # SHA256(sorted book_ids) 快速查重
    report_json = Column(Text, default="{}")     # 6 大模块的结构化内容
    generated_at = Column(DateTime, default=datetime.utcnow)
