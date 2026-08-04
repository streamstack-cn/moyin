# ============================================================
# 墨引 MoYin — 单容器生产镜像
#   nginx (前端静态资源 + 反代 /api) + uvicorn (FastAPI) + supervisord
#   内置 Calibre（格式转换）与 LibreOffice（Word 真脚注导出）
#
# 构建：docker build -t streamstack/moyin:latest .
# 多架构：docker buildx build --platform linux/amd64,linux/arm64 -t streamstack/moyin:latest --push .
# 运行：docker compose up -d   （见 docker-compose.yml）
# ============================================================

# ───────────────────────── 阶段 1：构建前端 ─────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build

COPY frontend/package*.json ./
# 使用 npm install：跨 amd64/arm64 时 lock 中的可选原生依赖更稳妥
RUN npm install --prefer-offline --no-audit --no-fund

COPY frontend/ .
RUN npm run build


# ───────────────────────── 阶段 2：生产运行镜像 ─────────────────────────
FROM python:3.12-slim-bookworm

WORKDIR /app

# 系统依赖：
#   nginx / supervisor        — 单容器进程编排
#   libreoffice-writer        — Word 真脚注导出（.fodt -> .docx headless 转换）
#   fonts-noto-cjk            — 保证中文在 LibreOffice 转换过程中正常排版
#   curl / wget / xdg-utils / xz-utils — 安装 Calibre 官方脚本所需的前置依赖
#   lib*                      — Calibre 内置 Qt 运行时依赖（无图形界面环境下 headless 运行）
# --no-install-recommends 避免拉入桌面环境的多余依赖，控制镜像体积
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    wget \
    xdg-utils \
    xz-utils \
    libegl1 \
    libopengl0 \
    libglx0 \
    libxkbcommon0 \
    libfontconfig1 \
    libglib2.0-0 \
    libxi6 \
    libxrender1 \
    libxrandr2 \
    libxtst6 \
    libxcb-cursor0 \
    libnss3 \
    libasound2 \
    libgl1 \
    tzdata \
    fonts-noto-cjk \
    fonts-wqy-zenhei \
    && ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# LibreOffice（仅 Writer 组件，够用即可，避免整套 libreoffice 体积过大）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

# Calibre：使用官方安装脚本安装到 /opt/calibre，用于 ebook-convert 格式转换
# （mobi/azw3/txt 等 -> epub）。QT_QPA_PLATFORM=offscreen 让其内置 Qt 在无显示环境下正常工作
ENV QT_QPA_PLATFORM=offscreen
RUN wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sh /dev/stdin install_dir=/opt \
    && ln -sf /opt/calibre/ebook-convert /usr/local/bin/ebook-convert \
    && ln -sf /opt/calibre/ebook-meta /usr/local/bin/ebook-meta

# 安装 Python 依赖（利用层缓存：仅 requirements.txt 变化时才重新安装）
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

ENV PYTHONPATH=/app/backend \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    RUNNING_IN_DOCKER=1

# 后端代码 + 版本号 / 更新日志（Docker Hub 仍只打 latest 标签，版本体现在应用内）
COPY VERSION /app/VERSION
COPY CHANGELOG.json /app/CHANGELOG.json
COPY backend/ /app/backend/

# 前端构建产物
COPY --from=frontend-builder /build/dist /app/frontend/dist

# nginx / supervisord 配置
COPY docker/nginx.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default && \
    ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 启动脚本
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN mkdir -p /config /app/backend/logs

EXPOSE 6173

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://127.0.0.1:6173/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
