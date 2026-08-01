# 墨引 MoYin

**私有化部署的电子书阅读 · 标注 · 引用管理系统**

[![Docker Pulls](https://img.shields.io/docker/pulls/streamstack/moyin)](https://hub.docker.com/r/streamstack/moyin)
[![Image](https://img.shields.io/docker/v/streamstack/moyin/latest?label=image)](https://hub.docker.com/r/streamstack/moyin/tags)
[![Platform](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-blue)](https://hub.docker.com/r/streamstack/moyin)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

统一书库、在线阅读 EPUB / PDF、划词高亮与笔记，并把引文整理进「引用篮」，导出带真脚注的 Word 草稿。适合 NAS / 家庭服务器 / 内网小团队。

---

## 快速安装

任选一种 Compose，**三步即可启动**（密码请在 yml 里改）。

### 方式 A：精简版（不含 Redis）

```bash
mkdir -p moyin/config && cd moyin
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/streamstack-cn/moyin/main/docker-compose.yml
docker compose up -d
```

### 方式 B：标准版（含 Redis，推荐）

```bash
mkdir -p moyin/config moyin/redis && cd moyin
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/streamstack-cn/moyin/main/docker-compose.redis.yml
docker compose up -d
```

打开：`http://<主机IP>:6173`（也可使用 `8420`）  
默认账号：`admin` /（yml 里的 `ADMIN_PASSWORD`，默认 `change_me`）

> 生产镜像里前端与 API 由 Nginx 统一在容器 `8420` 提供；Compose 将宿主机 **6173** 与 **8420** 都映射到该端口。开发时的 Vite `6173` 仅用于本地 `npm run dev`，不在镜像内单独跑。

```bash
docker compose logs -f moyin   # 看日志
docker compose down            # 停止
```

### Compose 文件说明

| 文件 | 内容 |
|------|------|
| [`docker-compose.yml`](./docker-compose.yml) | 单容器，内置 SQLite，无 Redis |
| [`docker-compose.redis.yml`](./docker-compose.redis.yml) | 应用 + Redis（数据目录 `./redis` 绑定挂载） |

挂载电子书目录时须**可读写**（删除图书会物理删除源文件），在 yml 中取消注释并改路径：

```yaml
- /path/to/your/ebooks:/library-source
```

Redis 使用宿主机目录绑定（非 Docker 命名卷），默认 `./redis:/data`，可改成绝对路径，例如：

```yaml
- /data/moyin-redis:/data
```

应用数据在 `./config`，请勿删除。

---

## 主要特点

| 特点 | 说明 |
|------|------|
| 多格式书库 | EPUB / PDF / TXT 在线读；MOBI / AZW3 / FB2 等自动转 EPUB |
| 沉浸阅读器 | 进度保存、继续阅读、返回原处、移动端友好 |
| 划词工具栏 | 高亮、批注、引用篮、脚注、书内搜索 |
| 引用篮 | 多项目、简繁、Word 真脚注与去重书目导出 |
| 元数据 | 豆瓣 / Google Books 补全封面与书目 |
| 目录入库 | 挂载宿主机目录扫描入库（类似 Komga） |
| 多用户 | 进度 / 标注 / 引用篮按账号隔离；书库目录全站共享 |

### 多用户隔离

管理员可创建多个读者。**阅读进度、高亮、笔记、收藏、引用篮按用户隔离**；书目、书架、标签、文件全站共享。

---

## 配置（按需）

密码与密钥直接写在 Compose 的 `environment` 中即可。常用项：

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 首次启动创建的管理员（库中已有用户后不覆盖） |
| `MOYIN_SECRET_KEY` | JWT 密钥，请改成随机串 |
| `REDIS_URL` | 仅标准版需要；与 Redis 服务密码一致 |
| `MOYIN_LIBRARY_ROOT` | 目录浏览根路径，默认 `/library-source` |
| `DATABASE_URL` | 可选，外挂 PostgreSQL；不设则用 `./config` 内 SQLite |
| `GOOGLE_BOOKS_API_KEY` | 可选；也可在管理后台配置 |

豆瓣登录在**管理后台**配置，无需环境变量。

`./config` 内主要数据：`moyin.db`、`uploads/`、`converted/`、`covers/`、`exports/`。

---

## 镜像

- Docker Hub：[`streamstack/moyin`](https://hub.docker.com/r/streamstack/moyin)
- 标签：`latest` · 平台：`linux/amd64`、`linux/arm64`
- 内含：Nginx + FastAPI + Calibre + LibreOffice Writer

```bash
docker pull streamstack/moyin:latest
```

---

## 本地开发（可选）

```bash
# 后端
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
MOYIN_DATA_DIR=./data uvicorn main:app --host 127.0.0.1 --port 8420

# 前端
cd frontend && npm ci && npm run dev   # http://127.0.0.1:6173
```

---

## 许可证

[MIT](./LICENSE) © streamstack-cn
