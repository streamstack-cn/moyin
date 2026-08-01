"""
redis_client.py — 可选的 Redis 客户端（缓存 / 登录限流 / 跨进程会话）

沿用项目"数据库、Redis 均可选"的原则：REDIS_URL 未配置或连接失败时 get_redis()
返回 None，所有调用方都必须在拿到 None 时优雅降级（跳过缓存、放弃限流、退回
进程内内存态），确保 Redis 只是性能/健壮性上的加分项，而不是新的强依赖，
不会影响单容器 SQLite 场景下开箱即用的体验。
"""

import logging
import os
from typing import Optional

import redis

logger = logging.getLogger("moyin.redis")

_client: Optional["redis.Redis"] = None
_checked = False


def get_redis() -> Optional["redis.Redis"]:
    """惰性连接，只在首次调用时尝试一次；后续复用同一个连接池（内部自带重连）"""
    global _client, _checked
    if _checked:
        return _client
    _checked = True

    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        return None
    try:
        client = redis.from_url(
            url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2
        )
        client.ping()
        _client = client
        logger.info("Redis 缓存已连接")
    except Exception as e:  # noqa: BLE001
        logger.warning("Redis 连接失败，将以无缓存模式运行：%s", e)
        _client = None
    return _client


def ping_ok() -> bool:
    """供 /api/admin/system 展示真实连接状态，而非仅判断环境变量是否配置"""
    client = get_redis()
    if not client:
        return False
    try:
        return bool(client.ping())
    except Exception:  # noqa: BLE001
        return False


def reset_for_tests() -> None:
    """测试/热重载时强制下一次 get_redis() 重新探测连接"""
    global _client, _checked
    _client = None
    _checked = False
