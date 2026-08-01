# 墨引 MoYin

**私有化部署的电子书阅读 · 标注 · 引用管理系统**

[![Docker Pulls](https://img.shields.io/docker/pulls/streamstack/moyin)](https://hub.docker.com/r/streamstack/moyin)
[![Image](https://img.shields.io/docker/v/streamstack/moyin/latest?label=image)](https://hub.docker.com/r/streamstack/moyin/tags)
[![Platform](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-blue)](https://hub.docker.com/r/streamstack/moyin)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 产品简介

墨引（MoYin）是一款面向个人与小团队的**自托管电子书工作台**：统一管理书库、在线阅读 EPUB / PDF、划词高亮与笔记，并把引文整理进「引用篮」，导出带真脚注的 Word 草稿与参考书目。

单容器即可运行（内置 SQLite）。提供 **不含 Redis** 与 **含 Redis** 两套 Compose；适合 NAS、家庭服务器或内网小团队部署。

---

## 多用户与数据隔离

管理员可在后台创建多个读者账号。隔离规则如下：

| 范围 | 是否隔离 | 说明 |
|------|----------|------|
| 阅读进度 / 状态 / 位置 | ✅ 按用户隔离 | 每人每书独立进度，互不可见 |
| 高亮与划词批注 | ✅ 按用户隔离 | |
| 每书 Markdown 笔记 | ✅ 按用户隔离 | |
| 收藏 | ✅ 按用户隔离 | |
| 引用篮 / 引用项目 | ✅ 按用户隔离 | |
| 个人书架（Collection） | ✅ 按用户隔离 | |
| 主题与阅读偏好 | ✅ 按用户隔离 | 存于账号 `preferences` |
| 书目、书架（Library）、标签 | ❌ 全站共享 | 管理员加载的书库目录统一，所有登录用户可见可读 |
| 封面与原文件 | ❌ 全站共享 | 任意登录用户可打开 / 下载 |
| 系统配置（豆瓣、扫描调度等） | ❌ 全站共享 | 仅管理员可改 |

结论：**个人阅读与写作数据完全隔离；书库目录与文件统一共享。**

---

## 主要特点

| 特点 | 说明 |
|------|------|
| 多格式书库 | EPUB、PDF、TXT 在线阅读；MOBI / AZW3 / FB2 等经 Calibre 转 EPUB；原文件可下载 |
| 沉浸阅读器 | 目录、字号与主题、进度自动保存、「继续阅读」「返回原处」、移动端手势友好 |
| 划词工具栏 | 四色高亮、批注、复制、加入引用篮、快速脚注、书内搜索 |
| 引用篮 | 多项目分组、简繁切换、同上引用简化、导出 Word 真脚注与去重书目（LibreOffice） |
| 元数据补全 | 豆瓣 Cookie / 扫码登录、Google Books 匹配封面与书目信息 |
| 目录入库 | 类似 Komga：挂载宿主机书库目录，浏览选文件夹创建书架并扫描入库 |
| 全库检索 | 书名 / 作者、高亮、引用、正文索引，结果可跳回阅读位置 |
| 多用户隔离 | 进度 / 标注 / 引用篮按账号隔离，书库统一 |
| 开箱部署 | 官方多架构镜像 `streamstack/moyin:latest`，Compose 精简版 / Redis 版任选 |

---

## 功能一览

- **书库**：上传或目录扫描、标签 / 书架浏览、收藏与阅读状态、批量管理
- **阅读**：EPUB（epub.js）与 PDF（pdf.js）、每书 Markdown 笔记侧栏
- **标注**：高亮列表跳转、选区操作气泡（桌面贴指针右侧，移动端底部）
- **写作**：引用篮项目、脚注预览、导出 docx
- **管理后台**：用户管理、豆瓣 / Google Books 配置、扫描调度、系统状态、SQLite 备份
- **账号**：JWT 登录，不开放自助注册，由管理员创建用户

---

## 快速开始（Docker Compose）

提供两种安装方式，按需选择。

| 方式 | 文件 | 适用场景 |
|------|------|----------|
| **A. 精简版（不含 Redis）** | `docker-compose.yml` | 个人使用、资源紧、只需核心阅读/标注 |
| **B. 标准版（含 Redis）** | `docker-compose.redis.yml` | 推荐小团队使用；元数据缓存、登录失败限流 |

### 1. 准备文件

```bash
git clone git@github.com:streamstack-cn/moyin.git
cd moyin
cp .env.example .env
mkdir -p config library-source
```

仅拉取 Compose 时：

```bash
mkdir -p moyin && cd moyin
# 精简版
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/streamstack-cn/moyin/main/docker-compose.yml
# 若选标准版，再拉一份（启动时用 -f 指定）
curl -fsSL -o docker-compose.redis.yml \
  https://raw.githubusercontent.com/streamstack-cn/moyin/main/docker-compose.redis.yml
curl -fsSL -o .env.example \
  https://raw.githubusercontent.com/streamstack-cn/moyin/main/.env.example
cp .env.example .env
mkdir -p config library-source
```

### 2. 修改 `.env`（必做）

**两种方式都需要：**

```env
ADMIN_PASSWORD=你的强密码
MOYIN_SECRET_KEY=一串足够长的随机字符串
```

**仅标准版（含 Redis）还需：**

```env
REDIS_PASSWORD=你的 Redis 密码
```

可选：挂载本机电子书目录（只读扫描源）：

```env
LIBRARY_HOST_PATH=/path/to/your/ebooks
```

### 3. 启动

**方式 A — 精简版（不含 Redis）：**

```bash
docker compose up -d
```

**方式 B — 标准版（含 Redis）：**

```bash
docker compose -f docker-compose.redis.yml up -d
```

浏览器访问：`http://<主机IP>:8420`  
默认管理员用户名见 `.env` 中 `ADMIN_USERNAME`（默认为 `admin`）。

查看日志：

```bash
docker compose logs -f moyin
# 标准版：
docker compose -f docker-compose.redis.yml logs -f
```

---

## 配置说明

### 环境变量

| 变量 | 必填 | 说明 | 默认 |
|------|------|------|------|
| `ADMIN_USERNAME` | 建议 | 首次启动创建的管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | **是** | 首次启动管理员密码（库中已有用户后不再覆盖） | `change_this_password` |
| `MOYIN_SECRET_KEY` | **是** | JWT 签名密钥 | 示例占位值 |
| `REDIS_PASSWORD` | 标准版必填 | 仅 `docker-compose.redis.yml` 使用，并拼进 `REDIS_URL` | 示例占位值 |
| `LIBRARY_HOST_PATH` | 否 | 宿主机书库源路径，挂载到容器 `/library-source` | `./library-source` |
| `MOYIN_LIBRARY_ROOT` | 否 | 容器内目录浏览器根路径 | `/library-source` |
| `MOYIN_TOKEN_EXPIRE_HOURS` | 否 | Token 有效期（小时） | `24` |
| `MOYIN_DATA_DIR` | 否 | 数据根目录（镜像内一般为 `/config`） | `/config` |
| `DATABASE_URL` | 否 | PostgreSQL 连接串；不设则用 SQLite | （空 → SQLite） |
| `REDIS_URL` | 否 | Redis 连接串；Compose 已自动注入 | （空 → 无缓存） |
| `GOOGLE_BOOKS_API_KEY` | 否 | Google Books；也可在管理后台配置 | （空） |
| `TZ` | 否 | 时区 | `Asia/Shanghai` |

豆瓣登录 Cookie / 扫码等在**管理后台**配置，无需写进环境变量。

### 数据目录 `/config`

请将 `./config` 持久化挂载，切勿删除：

| 路径 | 内容 |
|------|------|
| `/config/moyin.db` | SQLite 数据库（未使用 PostgreSQL 时） |
| `/config/uploads/` | 上传的原文件 |
| `/config/converted/` | Calibre 转换后的 EPUB 等 |
| `/config/covers/` | 封面 |
| `/config/exports/` | 导出的 Word / 书目文件 |

### Redis

| Compose 文件 | Redis |
|--------------|-------|
| `docker-compose.yml` | 不含；`REDIS_URL` 不注入，无缓存模式 |
| `docker-compose.redis.yml` | 含独立 `redis` 服务，自动注入 `REDIS_URL` |

启用 Redis 后可用于：

1. 豆瓣 / Google Books 元数据搜索结果缓存  
2. 登录失败次数限流  
3. 管理后台系统状态展示连接情况  

**不含 Redis 时，阅读、标注、引用篮、书库等核心功能完全可用。**

### PostgreSQL（可选）

大型或多用户场景可外挂 PostgreSQL，在 `.env` 或 compose 中设置：

```env
DATABASE_URL=postgresql://user:password@host:5432/moyin
```

容器内若填写 `127.0.0.1` / `localhost`，入口脚本会自动改写为 `host.docker.internal` 以便访问宿主机服务。

### 电子书源目录

将宿主机目录挂到 `/library-source`（只读）后，在管理界面「书库目录」中浏览文件夹、创建书架并扫描。源文件不会被修改，入库时复制 / 转换到 `/config`。

### 反向代理（可选）

对外暴露时建议在前面加 Nginx / Caddy / Traefik，并启用 HTTPS。应用监听 `8420`，API 与前端同域（路径 `/api`）。

---

## 镜像与架构

- Docker Hub：[`streamstack/moyin`](https://hub.docker.com/r/streamstack/moyin)
- 标签：`latest`
- 平台：`linux/amd64`、`linux/arm64`
- 镜像内含：Nginx + FastAPI（uvicorn）+ Calibre（`ebook-convert`）+ LibreOffice Writer

本地构建（可选）：

```bash
docker build -t streamstack/moyin:latest .
# 或
docker compose build
```

多架构示例：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t streamstack/moyin:latest \
  --push .
```

---

## 本地开发（可选）

**后端**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example ../.env.example   # 可按需自建 backend/.env
# 示例：
# ADMIN_USERNAME=admin ADMIN_PASSWORD=devpass \
# MOYIN_DATA_DIR=./data uvicorn main:app --host 127.0.0.1 --port 8420
```

**前端**

```bash
cd frontend
npm ci
npm run dev
# 默认 http://127.0.0.1:6173 ，/api 代理到 8420
# 可用 MOYIN_API_PROXY 覆盖代理目标
```

---

## 技术栈

- 前端：React · TypeScript · Vite · epub.js · pdf.js  
- 后端：FastAPI · SQLAlchemy · SQLite / PostgreSQL · Redis（可选）  
- 运行时：Nginx · Supervisor · Calibre · LibreOffice  

---

## 许可证

[MIT](./LICENSE) © streamstack-cn

---

## 致谢

- [Calibre](https://calibre-ebook.com/) · [epub.js](https://github.com/futurepress/epub.js) · [PDF.js](https://mozilla.github.io/pdf.js/)  
- 元数据来源：豆瓣、Google Books（需自行配置合规使用方式）
