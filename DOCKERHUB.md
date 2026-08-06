# 墨引 MoYin

当前版本：**V0.65**（应用内版本号；Docker 镜像标签 **`latest`** / **`v0.65`**）

**私有化部署的电子书阅读 · 标注 · 引用 · AI 伴读管理系统**

GitHub：https://github.com/streamstack-cn/moyin  
镜像：`streamstack/moyin:latest`（`linux/amd64` · `linux/arm64`）

统一书库、在线阅读 EPUB / PDF、划词高亮与笔记，把引文整理进「引用篮」并导出带真脚注的 Word 草稿；还可基于高亮 / 笔记 / 引用生成 AI 伴读报告。毛玻璃界面、桌面与移动端一致。适合 NAS / 家庭服务器 / 内网小团队。

---

## 主要功能

| 功能 | 说明 |
|------|------|
| 多格式书库 | EPUB / PDF / TXT 在线读；MOBI / AZW3 / FB2 等自动转 EPUB |
| 沉浸阅读 | 进度保存、继续阅读、返回原处、书内搜索；选区气泡毛玻璃质感，移动端友好 |
| 划词工具栏 | 高亮、批注、加入引用篮 / 当场新建引用篮、脚注 |
| 引用篮 | 多项目整理、简繁处理、Word 真脚注与去重书目导出 |
| AI 伴读 | 按高亮 / 笔记 / 引用生成阅读报告与追问；多服务商 API、画像可配 |
| 首页与书库 | 每日一句、全库搜索；高分推荐、书架拖拽排序 |
| 元数据 | 豆瓣（扫码登录）与 Google Books 并行匹配封面与书目 |
| 目录入库 | 挂载宿主机目录扫描入库；也可网页上传 |
| 多用户 | 读书数据按账号隔离；书库全站共享 |

### 权限与数据隔离

| 范围 | 规则 |
|------|------|
| **所有登录用户** | 浏览、阅读、高亮 / 笔记 / 收藏、管理自己的引用篮、使用 AI 伴读、**上传电子书**（入库后全员可见） |
| **仅管理员** | 元数据编辑与匹配、换封面、删书、转移书架、扫描书库、管理书库目录、管理后台 |
| **按用户隔离** | 阅读进度、高亮、笔记、收藏、引用篮、AI 伴读配置与报告 |
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
> 对应下方 Compose 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。上线前请改掉；**仅第一次建库时生效**，已有 `./config` 后改 yml 不会覆盖旧密码。

**推荐做法：直接复制下方完整 Compose → 改几处标注 → 启动。**  
Windows / Mac 小白请先看文末指南：**第一步必须先安装 Docker 工具**。

### 安装步骤（通用）

1. 新建目录（如 `moyin/`），并建好 `config`（标准版再加 `redis`）。  
2. 新建 `docker-compose.yml`，把下方某套配置**完整复制**进去。  
3. 按注释改密码、密钥、电子书路径（**不要加 `:ro`**）。  
4. 在该目录执行 `docker compose up -d`。  
5. 打开 `http://<主机IP>:6173`，用 **`admin` / `change_me`** 登录。

只需映射 **6173**。页面和 `/api` 都由该端口提供。

```bash
docker compose logs -f moyin
docker compose pull && docker compose up -d   # 升级（保留 ./config）
docker compose down
```

### 方式 B：标准版 Compose（含 Redis，推荐）

```yaml
# 墨引 MoYin — 标准版（含 Redis）
# mkdir -p config redis && docker compose up -d
# 访问 http://<主机IP>:6173   首次登录 admin / change_me

services:
  redis:
    image: redis:7.2-alpine
    container_name: moyin-redis
    restart: unless-stopped
    command: redis-server --requirepass change_me_redis --appendonly yes
    volumes:
      - ./redis:/data

  moyin:
    image: streamstack/moyin:latest
    container_name: moyin
    restart: unless-stopped
    depends_on:
      - redis
    ports:
      - "6173:6173"
    volumes:
      - ./config:/config
      # 【请改】左侧换成你的电子书目录，不要加 :ro
      # Windows：D:/ebooks:/library-source
      # Mac：/Users/你的用户名/Books:/library-source
      - /path/to/your/ebooks:/library-source
    environment:
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change_me
      MOYIN_SECRET_KEY: change_me_secret
      REDIS_URL: redis://:change_me_redis@redis:6379/0
```

### 方式 A：精简版 Compose（不含 Redis）

```yaml
# 墨引 MoYin — 精简版（不含 Redis）
# mkdir -p config && docker compose up -d
# 访问 http://<主机IP>:6173   首次登录 admin / change_me

services:
  moyin:
    image: streamstack/moyin:latest
    container_name: moyin
    restart: unless-stopped
    ports:
      - "6173:6173"
    volumes:
      - ./config:/config
      # 【请改】左侧换成你的电子书目录，不要加 :ro
      - /path/to/your/ebooks:/library-source
    environment:
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change_me
      MOYIN_SECRET_KEY: change_me_secret
```

### 方式 C：复用已有 Redis（局域网 / 宿主机）

```yaml
services:
  moyin:
    image: streamstack/moyin:latest
    container_name: moyin
    restart: unless-stopped
    ports:
      - "6173:6173"
    volumes:
      - ./config:/config
      - /path/to/your/ebooks:/library-source
    environment:
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change_me
      MOYIN_SECRET_KEY: change_me_secret
      # 局域网：redis://:密码@192.168.0.101:6379/2
      # 本机：redis://:密码@host.docker.internal:6379/2
      REDIS_URL: redis://:your_redis_password@192.168.0.101:6379/2
```

不要写成 `redis://:192.168.0.101:6379/2`（会把 IP 当成密码）。

### 部署前必读

| 要点 | 说明 |
|------|------|
| **数据只在 `./config`** | 换目录或删掉该目录等于空库。升级请保留。 |
| **Redis 可选** | 精简版可不配；标准版用同文件 Redis；也可按方式 C 指向已有实例。 |
| **电子书目录** | 只改挂载左侧：`- /你的书库:/library-source`，不要加 `:ro`。删除图书会物理删除源文件。曾用 `MOYIN_LIBRARY_ROOT` 自定义挂载时，换到 `/library-source` 后会自动重绑路径；也可继续用旧方式。 |
| **管理员密码只在首次生效** | 已有数据库后改 yml 不会改旧密码。 |

---

## 配置（按需）

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 首次创建管理员（有用户后不覆盖） |
| `MOYIN_SECRET_KEY` | 登录 JWT 密钥（不是 API Key）。正式环境请改成随机长串 |
| `REDIS_URL` | 可选。`redis://:密码@主机:端口/库号`；不配则内存缓存 |
| `DATABASE_URL` | 可选 PostgreSQL；默认 SQLite（`./config`） |
| `GOOGLE_BOOKS_API_KEY` | 可选；也可在管理后台配置 |
| `TZ` | 可选，如 `Asia/Shanghai` |

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
# 或固定版本
docker pull streamstack/moyin:v0.65
```

内含：Nginx + FastAPI + Calibre + LibreOffice Writer  

完整文档：https://github.com/streamstack-cn/moyin  

---

## 小白指南：Windows（Docker Desktop）

适合第一次用 Docker 的 Windows 用户。建议 Windows 10/11。

> **顺序不要反：先装 Docker Desktop，再复制 Compose / 启动墨引。**

### 1. 先安装 Docker Desktop（必做第一步）

1. 安装 [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)，按提示启用 **WSL2** 并重启。  
2. 启动 Docker Desktop，等到显示 **Engine running**。  
3. PowerShell 验证（两条都有版本号再往下做）：

```powershell
docker version
docker compose version
```

### 2. 复制 Compose 并编辑

```powershell
mkdir D:\moyin\config, D:\moyin\redis -Force
cd D:\moyin
```

用记事本新建 `docker-compose.yml`，把上文 **「方式 B」** 整段 YAML **复制粘贴**进去。  
把电子书路径改成例如 `- D:/ebooks:/library-source`（推荐正斜杠），并改掉默认密码。

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

> **顺序不要反：先装 OrbStack，再复制 Compose / 启动墨引。**

### 1. 先安装 OrbStack（必做第一步）

1. 打开 [orbstack.dev](https://orbstack.dev/) 下载、安装并启动 **OrbStack**。  
2. 菜单栏图标为运行中后，终端验证：

```bash
docker version
docker compose version
docker context show    # 应为 orbstack；否则执行 docker context use orbstack
```

### 2. 复制 Compose 并编辑

```bash
mkdir -p ~/moyin/config ~/moyin/redis
cd ~/moyin
```

新建 `docker-compose.yml`，把上文 **「方式 B」** 整段 YAML **复制粘贴**进去。  
把电子书路径改成例如 `/Users/你/Books:/library-source` 或 `/Volumes/盘名/ebooks:/library-source`，并改掉默认密码。

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
