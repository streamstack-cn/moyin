#!/bin/bash
# 墨引 MoYin 容器启动脚本
set -e

print_banner() {
    echo ""
    echo "  ============================================"
    echo "              墨引 MoYin 正在启动"
    echo "  ============================================"
    echo ""
}

log_info()  { echo "  ℹ️  $*"; }
log_ok()    { echo "  ✅ $*"; }
log_warn()  { echo "  ⚠️  $*"; }
log_error() { echo "  ❌ $*"; }

print_banner

# ─────────────────────────────────────────────────────────────────
# /config 数据目录检查（书库文件、数据库、导出文档均落盘于此，必须持久化挂载）
# ─────────────────────────────────────────────────────────────────
if [ ! -d /config ]; then
    log_error "/config 目录不存在"
    log_error "解决方法：在 docker-compose.yml 中添加 volume 挂载："
    log_error "  volumes:"
    log_error "    - ./config:/config"
    exit 1
fi

if ! touch /config/.write_test 2>/dev/null; then
    log_error "/config 目录无写入权限"
    log_error "解决方法：chmod 755 ./config  或  chown \$(id -u):\$(id -g) ./config"
    exit 1
fi
rm -f /config/.write_test

# ─────────────────────────────────────────────────────────────────
# 透明 loopback 转换：容器内 127.0.0.1 / localhost 指向容器自身，
# 若用户想连接宿主机上已有的 PostgreSQL / Redis，需要转换成 host.docker.internal
# ─────────────────────────────────────────────────────────────────
_loopback_to_host() {
    echo "$1" | sed \
        's|//127\.0\.0\.1|//host.docker.internal|g; s|//localhost|//host.docker.internal|g; s|@127\.0\.0\.1|@host.docker.internal|g; s|@localhost|@host.docker.internal|g'
}

if [ -n "${DATABASE_URL}" ]; then
    _NEW_DB_URL=$(_loopback_to_host "${DATABASE_URL}")
    if [ "${_NEW_DB_URL}" != "${DATABASE_URL}" ]; then
        log_info "DATABASE_URL: 127.0.0.1/localhost → host.docker.internal（容器内自动适配）"
        export DATABASE_URL="${_NEW_DB_URL}"
    fi
fi

if [ -n "${REDIS_URL}" ]; then
    _NEW_REDIS=$(_loopback_to_host "${REDIS_URL}")
    if [ "${_NEW_REDIS}" != "${REDIS_URL}" ]; then
        log_info "REDIS_URL: 127.0.0.1/localhost → host.docker.internal（容器内自动适配）"
        export REDIS_URL="${_NEW_REDIS}"
    fi
fi

# ─────────────────────────────────────────────────────────────────
# PostgreSQL 就绪等待（未配置 DATABASE_URL 时默认使用内置 SQLite，跳过此节）
# 建表统一由后端启动时 Base.metadata.create_all() 完成，此处只负责等待数据库可连接
# ─────────────────────────────────────────────────────────────────
if [ -n "${DATABASE_URL}" ] && echo "${DATABASE_URL}" | grep -q "^postgresql"; then
    log_info "检测到外部 PostgreSQL 配置，等待数据库就绪..."
    PG_READY=0
    for i in $(seq 1 30); do
        if python3 - <<'PYEOF' 2>/dev/null
import os, sys
from sqlalchemy import create_engine, text
try:
    engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    with engine.connect() as c:
        c.execute(text("SELECT 1"))
    engine.dispose()
    sys.exit(0)
except Exception:
    sys.exit(1)
PYEOF
        then
            PG_READY=1
            break
        fi
        log_info "PostgreSQL 尚未就绪，等待中... (${i}/30)"
        sleep 2
    done
    if [ "${PG_READY}" = "0" ]; then
        log_warn "PostgreSQL 60 秒内未就绪，继续启动——若持续无法连接请检查 DATABASE_URL"
    else
        log_ok "PostgreSQL 已就绪"
    fi
else
    log_info "使用内置 SQLite 数据库（如需切换到 PostgreSQL，设置 DATABASE_URL 环境变量）"
fi

# ─────────────────────────────────────────────────────────────────
# 环境自检：Calibre / LibreOffice 是否可用（不阻断启动，仅提示）
# ─────────────────────────────────────────────────────────────────
if command -v ebook-convert >/dev/null 2>&1; then
    log_ok "Calibre 格式转换：可用"
else
    log_warn "Calibre 未就绪，非 EPUB/TXT 格式的电子书将仅可下载，无法在线阅读"
fi

if command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; then
    log_ok "LibreOffice Word 真脚注导出：可用"
else
    log_warn "LibreOffice 未就绪，Word 导出将降级为纯文本编号列表"
fi

# ─────────────────────────────────────────────────────────────────
# 配置摘要
# ─────────────────────────────────────────────────────────────────
log_info "数据目录：/config"
log_info "时区：${TZ:-Asia/Shanghai}"

if [ -n "$ADMIN_USERNAME" ]; then
    log_info "管理员账号：${ADMIN_USERNAME}（来自环境变量，仅首次启动生效）"
else
    log_warn "未设置 ADMIN_USERNAME，首次启动将创建默认账号 admin / moyin12345"
    log_warn "强烈建议在 docker-compose.yml 中配置 ADMIN_USERNAME 和 ADMIN_PASSWORD"
fi

HOST_PORT="${APP_PORT:-8420}"

check_port() {
    local port=$1
    if command -v ss >/dev/null 2>&1; then
        ss -tlnp 2>/dev/null | grep -q ":${port}[[:space:]]" || return 0
    else
        return 0
    fi
    log_warn "端口 ${port} 在容器内已被占用（一般不应发生，请检查镜像是否重复启动进程）"
}
check_port "${HOST_PORT}"

echo ""
log_ok "配置检查通过，正在启动服务（nginx :${HOST_PORT} + uvicorn）..."
echo ""

exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf
