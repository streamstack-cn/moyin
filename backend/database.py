"""
database.py — 数据库连接与会话管理

默认使用内置 SQLite（零配置启动），可通过环境变量 DATABASE_URL 切换到外部
PostgreSQL（推荐多用户/大书库场景使用，以获得更好的并发与全文检索能力）。
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

DATA_DIR = Path(os.environ.get("MOYIN_DATA_DIR", "/config"))
if not DATA_DIR.exists():
    # 本地开发环境下没有 /config，退回到项目内的 data 目录
    DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_SQLITE = not DATABASE_URL or DATABASE_URL.startswith("sqlite")

if not DATABASE_URL:
    DATABASE_URL = f"sqlite:///{DATA_DIR / 'moyin.db'}"

connect_args = {"check_same_thread": False} if IS_SQLITE else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    future=True,
)

if IS_SQLITE:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # WAL 模式提升并发读写能力，busy_timeout 减少 "database is locked" 报错
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import models  # noqa: F401  确保所有模型都已注册到 Base.metadata
    Base.metadata.create_all(bind=engine)
    _sync_missing_columns()


def _sync_missing_columns():
    """轻量级增量迁移：create_all() 只建新表，不会给已存在的表补新列。
    项目当前未接入 Alembic，这里对 SQLite/Postgres 通用地补齐缺失字段，
    避免每次给模型加字段都要求用户手动删库重建。
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing_cols:
                    continue
                col_type = col.type.compile(dialect=engine.dialect)
                default_sql = ""
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    val = col.default.arg
                    if isinstance(val, str):
                        default_sql = f" DEFAULT '{val}'"
                    elif isinstance(val, bool):
                        default_sql = f" DEFAULT {1 if val else 0}"
                    elif isinstance(val, (int, float)):
                        default_sql = f" DEFAULT {val}"
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type}{default_sql}'))
