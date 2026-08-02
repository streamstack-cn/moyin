# 墨引 MoYin

当前版本：**V0.5**（标签：`latest` / `0.5` / `v0.5`）

**私有化部署的电子书阅读 · 标注 · 引用管理系统**

GitHub：https://github.com/streamstack-cn/moyin  
镜像：`streamstack/moyin:latest`（`linux/amd64` · `linux/arm64`）

统一书库、在线阅读 EPUB / PDF、划词高亮与笔记，并把引文整理进「引用篮」，导出带真脚注的 Word 草稿。适合 NAS / 家庭服务器 / 内网小团队。

---

## 主要功能

| 功能 | 说明 |
|------|------|
| 多格式书库 | EPUB / PDF / TXT 在线读；MOBI / AZW3 / FB2 等自动转 EPUB |
| 沉浸阅读 | 进度保存、继续阅读、返回原处、书内搜索、移动端友好 |
| 划词工具栏 | 高亮、批注、加入引用篮 / 当场新建引用篮、脚注 |
| 引用篮 | 多项目整理、简繁处理、Word 真脚注与去重书目导出 |
| 首页搜索 | 书名 / 高亮 / 引用 / 正文统一检索，结果带封面缩略图 |
| 元数据 | 豆瓣（扫码登录）与 Google Books 并行匹配封面与书目 |
| 目录入库 | 挂载宿主机目录扫描入库；也可网页上传 |
| 多用户 | 读书数据按账号隔离；书库全站共享 |

### 权限与数据隔离

| 范围 | 规则 |
|------|------|
| **所有登录用户** | 浏览、阅读、高亮 / 笔记 / 收藏、管理自己的引用篮、**上传电子书**（入库后全员可见） |
| **仅管理员** | 元数据编辑与匹配、换封面、删书、转移书架、扫描书库、管理书库目录、管理后台 |
| **按用户隔离** | 阅读进度、高亮、笔记、收藏、引用篮 |
| **全站共享** | 书目、书架、标签、电子书文件与封面 |

管理员删书时，所有人在该书上的关联读书数据会一并清理。

---

## 快速安装

> **首次登录（请醒目记住）**
>
> | | |
> |---|---|
> | **用户名** | `admin` |
> | **密码** | `change_me` |
>
> 对应 Compose 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。上线前请改掉；**仅第一次建库时生效**，已有 `./config` 后改 yml 不会覆盖旧密码。

任选一种 Compose。Windows / Mac 小白请先看文末指南：**第一步必须先安装 Docker 工具**。

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

**访问：** `http://<主机IP>:6173` → 用 **`admin` / `change_me`** 登录。

只需映射 **6173**。页面和 `/api` 都由该端口提供。

```bash
docker compose logs -f moyin
docker compose pull && docker compose up -d   # 升级（保留 ./config）
docker compose down
```

### 部署前必读

| 要点 | 说明 |
|------|------|
| **数据只在 `./config`** | 数据库、封面等都在宿主机 `./config`。换目录或删掉该目录等于空库。升级请保留。 |
| **Redis 看 Compose** | 精简版不含 Redis；要用请选标准版。 |
| **电子书目录须挂载且可写** | 例如 `- /path/to/ebooks:/library-source`，设置 `MOYIN_LIBRARY_ROOT=/library-source`。**不要加 `:ro`。删除图书会物理删除源文件。** |
| **管理员密码只在首次生效** | 已有数据库后改 yml 不会改旧密码。 |

### Compose 说明

| 文件 | 内容 |
|------|------|
| [docker-compose.yml](https://github.com/streamstack-cn/moyin/blob/main/docker-compose.yml) | 单容器 SQLite，无 Redis |
| [docker-compose.redis.yml](https://github.com/streamstack-cn/moyin/blob/main/docker-compose.redis.yml) | 应用 + Redis |

```yaml
volumes:
  - ./config:/config
  - /path/to/your/ebooks:/library-source
environment:
  MOYIN_LIBRARY_ROOT: /library-source
```

标准版 Redis 密码改两处：`--requirepass` 与 `REDIS_URL`（须一致）。

---

## 配置（按需）

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 首次创建管理员（有用户后不覆盖） |
| `MOYIN_SECRET_KEY` | JWT 密钥，请改成随机串 |
| `REDIS_URL` | 仅标准版；与 Redis 密码一致 |
| `MOYIN_LIBRARY_ROOT` | 目录浏览根，默认 `/library-source` |
| `DATABASE_URL` | 可选 PostgreSQL；默认 SQLite（`./config`） |
| `GOOGLE_BOOKS_API_KEY` | 可选；也可在管理后台配置 |

豆瓣登录在管理后台扫码配置。  
`./config`：`moyin.db`、`uploads/`、`converted/`、`covers/`、`exports/`。

### 首次使用建议

1. 登录管理员，改掉默认弱密码。  
2. 管理后台配置豆瓣 / Google（可选）。  
3. 「管理书库目录」创建书架并扫描，或直接上传电子书。  
4. 多人使用时创建「读者」账号。

---

## 拉取镜像

```bash
docker pull streamstack/moyin:latest
```

内含：Nginx + FastAPI + Calibre + LibreOffice Writer  

完整文档：https://github.com/streamstack-cn/moyin  

---

## 小白指南：Windows（Docker Desktop）

适合第一次用 Docker 的 Windows 用户。建议 Windows 10/11。

> **顺序不要反：先装 Docker Desktop，再下载 Compose / 启动墨引。**

### 1. 先安装 Docker Desktop（必做第一步）

1. 安装 [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)，按提示启用 **WSL2** 并重启。  
2. 启动 Docker Desktop，等到显示 **Engine running**。  
3. PowerShell 验证（两条都有版本号再往下做）：

```powershell
docker version
docker compose version
```

### 2. 再部署墨引

```powershell
mkdir D:\moyin\config -Force
cd D:\moyin
curl.exe -fsSL -o docker-compose.yml `
  https://raw.githubusercontent.com/streamstack-cn/moyin/main/docker-compose.redis.yml
mkdir .\redis -Force
```

编辑 yml：改密码；挂载书库（推荐正斜杠）：

```yaml
volumes:
  - ./config:/config
  - D:/ebooks:/library-source
environment:
  MOYIN_LIBRARY_ROOT: /library-source
```

```powershell
docker compose up -d
```

访问 `http://127.0.0.1:6173`。  
**首次登录：** 用户名 `admin`，密码 `change_me`。

### Windows 避坑

| 坑 | 怎么避 |
|----|--------|
| Engine 起不来 | 开虚拟化；确认 WSL2；Docker Desktop 使用 WSL2 后端 |
| 扫描不到书 | 路径写错，或 File sharing 未允许该盘符 |
| 加了 `:ro` | 电子书目录请读写挂载 |
| 升级后空库 | 别删 / 换掉 `config` 目录 |
| 改 yml 密码无效 | 库已存在时 `ADMIN_PASSWORD` 不再生效 |
| 端口占用 | 改映射如 `"6174:6173"` |

升级：`docker compose pull && docker compose up -d`  
备份：复制整个 `config`（标准版可再备份 `redis`）。

---

## 小白指南：Mac（OrbStack）

推荐 [OrbStack](https://orbstack.dev/)（轻量，命令仍是 `docker` / `docker compose`）。M 系列与 Intel 均可。

> **顺序不要反：先装 OrbStack，再下载 Compose / 启动墨引。**

### 1. 先安装 OrbStack（必做第一步）

1. 打开 [orbstack.dev](https://orbstack.dev/) 下载、安装并启动 **OrbStack**。  
2. 菜单栏图标为运行中后，终端验证：

```bash
docker version
docker compose version
docker context show    # 应为 orbstack；否则执行 docker context use orbstack
```

### 2. 再部署墨引

```bash
mkdir -p ~/moyin/config ~/moyin/redis
cd ~/moyin
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/streamstack-cn/moyin/main/docker-compose.redis.yml
```

编辑 yml：改密码；挂载例如 `/Users/你/Books:/library-source` 或 `/Volumes/盘名/ebooks:/library-source`。

```bash
docker compose up -d
```

访问 `http://127.0.0.1:6173`。  
**首次登录：** 用户名 `admin`，密码 `change_me`。

### Mac / OrbStack 避坑

| 坑 | 怎么避 |
|----|--------|
| `/Volumes` 外置盘失效 | 先挂载磁盘再启动容器；盘名勿随意改 |
| 宿主机路径写错 | Compose 左侧是 Mac 路径，右侧才是容器路径 |
| 与 Docker Desktop 冲突 | `docker context use orbstack`，退出 Desktop |
| 升级后空库 | 保留 `~/moyin/config` |
| 电子书只读挂载 | 不要加 `:ro` |

升级：`docker compose pull && docker compose up -d`  
备份：复制 `~/moyin/config`。

---

许可证：[MIT](https://github.com/streamstack-cn/moyin/blob/main/LICENSE) © streamstack-cn
