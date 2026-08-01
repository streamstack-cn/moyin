# 墨引 MoYin

**私有化部署的电子书阅读 · 标注 · 引用管理系统**

GitHub：https://github.com/streamstack-cn/moyin  
镜像：`streamstack/moyin:latest`（`linux/amd64` · `linux/arm64`）

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

**访问前端地址：** `http://<主机IP>:6173`  

默认账号：`admin` /（yml 里的 `ADMIN_PASSWORD`，默认 `change_me`）

> 只需映射并访问 **6173**。页面和 `/api` 都由该端口提供，**不必再映射后端端口**。

```bash
docker compose logs -f moyin   # 看日志
docker compose down            # 停止
```

### 部署前必读（避免「书库空了 / 封面没了 / Redis 没连上」）

| 要点 | 说明 |
|------|------|
| **数据只在 `./config`** | 数据库、封面等都在宿主机 `./config`。换目录启动或删掉该目录，会看成空库。升级请保留 `config`。 |
| **Redis 看 Compose 版本** | 精简版不含 Redis；要用请选标准版 `docker-compose.redis.yml`。 |
| **电子书目录必须挂载且可写** | 例如 `- /path/to/ebooks:/library-source`，并设置 `MOYIN_LIBRARY_ROOT=/library-source`。删除图书会物理删除源文件。 |
| **管理员密码只在首次生效** | 已有数据库后改 yml 里的 `ADMIN_PASSWORD` 不会改旧密码。 |
| **本地开发数据 ≠ Docker 数据** | `backend/data`（本地 uvicorn）与 Docker 的 `./config` 不是同一份，迁移需手动拷贝并挂载原书库盘。 |

### Compose 说明

| 文件 | 内容 |
|------|------|
| [docker-compose.yml](https://github.com/streamstack-cn/moyin/blob/main/docker-compose.yml) | 单容器，内置 SQLite，**无 Redis** |
| [docker-compose.redis.yml](https://github.com/streamstack-cn/moyin/blob/main/docker-compose.redis.yml) | 应用 + Redis（`./redis` 目录绑定挂载） |

```yaml
volumes:
  - ./config:/config
  - /path/to/your/ebooks:/library-source
environment:
  MOYIN_LIBRARY_ROOT: /library-source
```

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

**多用户隔离**：阅读进度、高亮、笔记、收藏、引用篮按用户隔离；书目、书架、标签、文件全站共享。

---

## 配置（按需）

密码与密钥直接写在 Compose 的 `environment` 中即可：

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 首次启动创建的管理员（库中已有用户后不覆盖） |
| `MOYIN_SECRET_KEY` | JWT 密钥，请改成随机串 |
| `REDIS_URL` | 仅标准版需要；与 Redis 服务密码一致 |
| `MOYIN_LIBRARY_ROOT` | 目录浏览根路径，默认 `/library-source` |
| `DATABASE_URL` | 可选，外挂 PostgreSQL；不设则用 `./config` 内 SQLite |
| `GOOGLE_BOOKS_API_KEY` | 可选；也可在管理后台配置 |

豆瓣登录在**管理后台**配置。  
`./config` 内主要数据：`moyin.db`、`uploads/`、`converted/`、`covers/`、`exports/`。

---

## 拉取镜像

```bash
docker pull streamstack/moyin:latest
```

镜像内含：Nginx + FastAPI + Calibre + LibreOffice Writer

完整文档与源码：https://github.com/streamstack-cn/moyin  

许可证：[MIT](https://github.com/streamstack-cn/moyin/blob/main/LICENSE) © streamstack-cn
