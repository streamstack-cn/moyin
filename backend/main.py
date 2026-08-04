"""main.py — 墨引 MoYin FastAPI 应用入口"""

import logging
from pathlib import Path

# 本地 backend/.env 优先加载（REDIS_URL 等），再读系统环境变量
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import api_admin
import api_auth
import api_books
import api_citation
import api_douban
import api_highlights
import api_libraries
import api_meta
import api_notes
import api_search
import api_tags
from database import SessionLocal, init_db
from security import ensure_admin_seed
from version import APP_VERSION_LABEL, __version__

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("moyin")
# 避免 httpx 把带 API Key 的完整 URL 打进日志
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="墨引 MoYin", description="电子书阅读 / 标注 / 引用管理系统", version=__version__)

# 局域网 / 反向代理场景下全面放开 CORS，鉴权仍由 Bearer Token 保证
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()
    db = SessionLocal()
    try:
        ensure_admin_seed(db)
        api_books._cleanup_orphan_tags(db)  # 自愈历史遗留的 0 计数僵尸标签
        from services import library_jobs, library_watcher

        settings = library_jobs.load_schedule_settings(db)
        library_watcher.start_watchers(debounce_sec=float(settings["watch_debounce_sec"]))
        library_jobs.start_scheduler()
    finally:
        db.close()
    try:
        from services import redis_client

        if redis_client.get_redis():
            logger.info("Redis 已就绪")
        elif __import__("os").environ.get("REDIS_URL", "").strip():
            logger.warning("已配置 REDIS_URL 但未能连接 Redis")
        else:
            logger.info("未配置 REDIS_URL，以无缓存模式运行")
    except Exception as e:  # noqa: BLE001
        logger.warning("Redis 探测失败：%s", e)
    logger.info("墨引 MoYin 后端已启动")


@app.on_event("shutdown")
def on_shutdown():
    try:
        from services import library_jobs, library_watcher

        library_watcher.stop_watchers()
        library_jobs.stop_scheduler()
    except Exception:  # noqa: BLE001
        pass
    logger.info("墨引 MoYin 后端已关闭")


app.include_router(api_auth.router)
app.include_router(api_books.router)
app.include_router(api_libraries.router)
app.include_router(api_highlights.router)
app.include_router(api_notes.router)
app.include_router(api_citation.router)
app.include_router(api_douban.router)
app.include_router(api_meta.router)
app.include_router(api_search.router)
app.include_router(api_tags.router)
app.include_router(api_tags.collections_router)
app.include_router(api_admin.router)
app.include_router(api_admin.settings_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "moyin", "version": __version__, "version_label": APP_VERSION_LABEL}
