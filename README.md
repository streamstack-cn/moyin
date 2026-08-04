# 墨引 MoYin

当前版本：**V0.6**（应用内显示的内部版本号；Docker 镜像标签为 `latest`，亦可拉取 `v0.6`）

**私有化部署的电子书阅读 · 标注 · 引用 · AI 伴读管理系统**

[![Docker Hub](https://img.shields.io/badge/Docker_Hub-streamstack%2Fmoyin-066da5?logo=docker&logoColor=white)](https://hub.docker.com/r/streamstack/moyin)
[![Docker Pulls](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fhub.docker.com%2Fv2%2Frepositories%2Fstreamstack%2Fmoyin%2F&query=%24.pull_count&label=docker%20pulls&color=066da5&logo=docker&logoColor=white&cacheSeconds=300)](https://hub.docker.com/r/streamstack/moyin)
[![Platform](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-blue)](https://hub.docker.com/r/streamstack/moyin)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**镜像：** [`streamstack/moyin:latest`](https://hub.docker.com/r/streamstack/moyin) · **源码：** [`streamstack-cn/moyin`](https://github.com/streamstack-cn/moyin)

统一书库、在线阅读 EPUB / PDF、划词高亮与笔记，把引文整理进「引用篮」并导出带真脚注的 Word 草稿；还可基于你的高亮 / 笔记 / 引用生成 AI 伴读报告。界面采用毛玻璃与高级动效，桌面与移动端一致。适合 NAS / 家庭服务器 / 内网小团队。

---

## 主要功能

| 功能 | 说明 |
|------|------|
| 多格式书库 | EPUB / PDF / TXT 在线读；MOBI / AZW3 / FB2 等自动转 EPUB |
| 沉浸阅读 | 进度保存、继续阅读、返回原处、书内搜索；选区气泡 / 主题弹层毛玻璃质感，移动端友好 |
| 划词工具栏 | 高亮、批注、加入引用篮 / 当场新建引用篮、脚注 |
| 引用篮 | 多项目整理、简繁处理、Word 真脚注与去重书目导出 |
| AI 伴读 | 按高亮 / 笔记 / 引用生成阅读报告与追问；多服务商 API、画像可配、历史报告带封面 |
| 首页与书库 | 每日一句悬浮预览、全库搜索；高分推荐（豆瓣分排序）、书架拖拽排序 |
| 元数据 | 豆瓣（扫码登录）与 Google Books 并行匹配封面与书目 |
| 目录入库 | 挂载宿主机目录扫描入库（类似 Komga）；也可网页上传 |
| 多用户 | 读书数据按账号隔离；书库全站共享（详见下节） |

### 权限与数据隔离（务必读）

| 范围 | 规则 |
|------|------|
| **所有登录用户** | 浏览书库、阅读、高亮 / 笔记 / 收藏、管理自己的引用篮、使用 AI 伴读、**上传电子书**（入库后全员可见） |
| **仅管理员** | 元数据编辑与在线匹配、换封面、删书、转移书架、扫描书库、管理书库目录、管理后台（用户 / 豆瓣 / 系统配置） |
| **按用户隔离** | 阅读进度、高亮、笔记、收藏、引用篮及其条目、AI 伴读配置与报告 |
| **全站共享** | 书目、书架、标签、电子书文件与封面 |

读者直访 `/admin` 会被拦回首页；管理接口服务端也会校验管理员身份。  
管理员删一本书时，所有人在该书上的进度 / 高亮等关联数据会一并清理。

---

## 快速安装

> **首次登录（请醒目记住）**
>
> | | |
> |---|---|
> | **用户名** | `admin` |
> | **密码** | `change_me` |
>
> 对应下方 Compose 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。上线前请改掉默认密码；**仅第一次建库时生效**，已有 `./config` 数据后改 yml 不会覆盖旧密码。

**推荐做法：直接复制下方完整 Compose → 改几处标注 → 启动。**  
Windows / Mac 小白请先看文末指南：**第一步必须先安装 Docker 工具**。

### 安装步骤（通用）

1. 新建目录，例如 `moyin/`，并建好数据子目录。  
2. 在该目录新建文件 `docker-compose.yml`，把下方某套配置**完整复制**进去。  
3. 按注释改：密码、密钥、电子书目录路径（**不要加 `:ro`**）。  
4. 在该目录执行：`docker compose up -d`  
5. 浏览器打开 `http://<主机IP>:6173`，用 **`admin` / `change_me`**（或你改后的密码）登录。

```bash
# 标准版需要 config + redis；精简版只要 config
mkdir -p moyin/config moyin/redis && cd moyin
# 用编辑器创建 docker-compose.yml，粘贴下方配置并保存
docker compose up -d
```

> 只需映射并访问 **6173**。页面和 `/api` 都走该端口，**不必再映射后端端口**。

```bash
docker compose logs -f moyin   # 看日志
docker compose pull && docker compose up -d   # 升级镜像（保留 ./config）
docker compose down            # 停止（不删数据）
```

### 方式 B：标准版 Compose（含 Redis，推荐）

直接复制整段保存为 `docker-compose.yml`：

```yaml
# 墨引 MoYin — 标准版（含 Redis：元数据缓存 / 登录限流）
# 使用：mkdir -p config redis && 保存本文件为 docker-compose.yml 后 docker compose up -d
# 访问：http://<主机IP>:6173   首次登录 admin / change_me

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
      # 全部应用数据（数据库/封面/转换文件）。勿删、换目录启动等于新库
      - ./config:/config
      # 【请改成你的电子书目录】左侧是宿主机路径，不要加 :ro
      # Windows 示例：D:/ebooks:/library-source
      # Mac 示例：/Users/你的用户名/Books:/library-source
      - /path/to/your/ebooks:/library-source
    environment:
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change_me          # 【请修改】仅首次建库生效
      MOYIN_SECRET_KEY: change_me_secret # 【请修改】随机长字符串
      MOYIN_LIBRARY_ROOT: /library-source
      # Redis 密码须与上方 --requirepass 一致（改密码时两处一起改）
      REDIS_URL: redis://:change_me_redis@redis:6379/0
```

### 方式 A：精简版 Compose（不含 Redis）

不需要 Redis 时用这一套：

```yaml
# 墨引 MoYin — 精简版（不含 Redis）
# 使用：mkdir -p config && 保存本文件为 docker-compose.yml 后 docker compose up -d
# 访问：http://<主机IP>:6173   首次登录 admin / change_me

services:
  moyin:
    image: streamstack/moyin:latest
    container_name: moyin
    restart: unless-stopped
    ports:
      - "6173:6173"
    volumes:
      - ./config:/config
      # 【请改成你的电子书目录】左侧是宿主机路径，不要加 :ro
      - /path/to/your/ebooks:/library-source
    environment:
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change_me          # 【请修改】仅首次建库生效
      MOYIN_SECRET_KEY: change_me_secret # 【请修改】随机长字符串
      MOYIN_LIBRARY_ROOT: /library-source
```

仓库里也有同名文件备查：[`docker-compose.yml`](./docker-compose.yml)、[`docker-compose.redis.yml`](./docker-compose.redis.yml)。

### 部署前必读

| 要点 | 说明 |
|------|------|
| **数据只在 `./config`** | 数据库、封面、转换文件、上传书都在宿主机 `./config`（容器内 `/config`）。换目录启动、删掉 `config`、挂错路径，都会看成空库。升级镜像务必保留该目录。 |
| **Redis 看 Compose** | 精简版不含 Redis（正常）；要缓存 / 登录限流用标准版，并确认日志有 `Redis 已就绪`。 |
| **电子书目录必须挂载且可写** | 把 `/path/to/your/ebooks` 换成真实路径，**不要加 `:ro`**。`MOYIN_LIBRARY_ROOT` 须与容器内挂载点一致（默认 `/library-source`）。**删除图书会物理删除源文件。** |
| **管理员密码只在首次生效** | `ADMIN_PASSWORD` 仅在 `./config` 里还没有用户时创建账号。已有库后改 yml **不会**改旧密码。 |
| **本地开发 ≠ Docker 数据** | 本地 `uvicorn` 默认写 `backend/data`；Docker 用 `./config`。两套互不相通，迁移需手动拷贝并挂载原来的书库路径。 |

---

## 配置（按需）

写在 Compose 的 `environment` 即可：

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 首次启动创建的管理员（库中已有用户后不覆盖） |
| `MOYIN_SECRET_KEY` | JWT 密钥，请改成随机长串 |
| `REDIS_URL` | 仅标准版需要；密码与 Redis `--requirepass` 一致 |
| `MOYIN_LIBRARY_ROOT` | 目录浏览根路径，默认 `/library-source` |
| `DATABASE_URL` | 可选，外挂 PostgreSQL；不设则用 `./config` 内 SQLite |
| `GOOGLE_BOOKS_API_KEY` | 可选；也可在管理后台配置 |
| `TZ` | 可选，如 `Asia/Shanghai` |

豆瓣登录在**管理后台**扫码配置，无需环境变量。  
`./config` 内主要数据：`moyin.db`、`uploads/`、`converted/`、`covers/`、`exports/`。

### 首次使用建议

1. 登录管理员 → 改掉默认密码（或在管理后台新建账号后停用默认策略）。  
2. 管理后台配置豆瓣扫码（可选）与 Google API Key（可选）。  
3. 「管理书库目录」选中已挂载文件夹创建书架并扫描；或直接「上传电子书」。  
4. 需要多人使用时，在管理后台创建「读者」账号。

---

## 镜像

- Docker Hub：[`streamstack/moyin`](https://hub.docker.com/r/streamstack/moyin)
- 镜像标签：推荐 **`latest`**；版本标签 **`v0.6`** 与应用内 `V0.6` 对应
- 平台：`linux/amd64`、`linux/arm64`（Intel / Apple Silicon / 常见 NAS 均可）
- 内含：Nginx + FastAPI + Calibre + LibreOffice Writer

```bash
docker pull streamstack/moyin:latest
# 或固定版本
docker pull streamstack/moyin:v0.6
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

## 小白指南：Windows（Docker Desktop）

面向第一次用 Docker 的 Windows 用户。建议系统：**Windows 10/11 64 位**。

> **顺序不要反：先装 Docker Desktop，再复制 Compose / 启动墨引。**  
> 没装好 Docker 时，后面所有 `docker` 命令都会失败。

### 1. 先安装 Docker Desktop（必做第一步）

1. 打开 [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)，下载并安装。  
2. 安装过程若提示启用 **WSL2** / 虚拟化，按提示完成并**重启电脑**。  
3. 从开始菜单启动 **Docker Desktop**，等到左下角变为 **Engine running**（引擎已运行）。  
4. 打开 PowerShell 或 Windows Terminal，确认：

```powershell
docker version
docker compose version
```

两条都能输出版本号，才进入下一步。若提示找不到命令：把 Docker Desktop 完全退出再开一次，或检查是否已加入 PATH。

### 2. 复制 Compose 配置并编辑

1. 新建目录（路径可改）：

```powershell
mkdir D:\moyin\config, D:\moyin\redis -Force
cd D:\moyin
```

2. 用记事本 / VS Code 新建 `D:\moyin\docker-compose.yml`，把上文 **「方式 B：标准版 Compose」** 整段 YAML **复制粘贴**进去并保存。  
3. 按需修改：
   - `ADMIN_PASSWORD`、`MOYIN_SECRET_KEY`
   - Redis 密码：`--requirepass` 与 `REDIS_URL` **两处一起改**
   - 电子书目录：把 `/path/to/your/ebooks` 改成你的路径，**推荐正斜杠**，例如：

```yaml
      - D:/ebooks:/library-source
```

也可写 `D:\ebooks`；正斜杠更少踩转义坑。Docker Desktop → Settings → Resources → File sharing 需允许该盘符。

### 3. 启动与访问

```powershell
cd D:\moyin
docker compose up -d
docker compose logs -f moyin
```

浏览器打开：`http://127.0.0.1:6173`  
本机其它设备访问：`http://<这台电脑的局域网IP>:6173`（需放行防火墙入站 6173）。

**首次登录：** 用户名 `admin`，密码 `change_me`（若你已在 yml 里改过 `ADMIN_PASSWORD`，则用你改后的密码）。

### 4. Windows 常见坑

| 坑 | 怎么避 |
|----|--------|
| Docker 起不来 / 一直 Starting | 确认 BIOS 开了虚拟化；WSL2 已安装（`wsl --status`）；Docker Desktop → Settings → General 使用 WSL2。 |
| `docker compose` 报错找不到 | 用 Compose V2 插件（`docker compose`，中间有空格），不要依赖旧的 `docker-compose.exe`。 |
| 书库扫描不到文件 | 挂载路径写错，或 Docker Desktop → Settings → Resources → File sharing 未允许该盘符。改完点 Apply。 |
| 加了 `:ro` 只读 | 删除图书、扫描同步可能失败。电子书目录请读写挂载。 |
| 端口占用 | 6173 被占用时改 `ports` 为 `"6174:6173"`，浏览器改访问 6174。 |
| 升级后书库空了 | 是否换了启动目录、删了 `D:\moyin\config`？数据只认你挂载的那个 `config`。 |
| 改了 yml 密码登不进去 | 库已存在时 `ADMIN_PASSWORD` 不再生效；用原密码登录，或清库（会丢数据）重建。 |
| 外置硬盘路径 | 盘符变化会导致容器内路径失效。尽量固定盘符，或改用稳定路径。 |

### 5. 升级 / 备份

```powershell
cd D:\moyin
docker compose pull
docker compose up -d
```

备份：停服务后复制整个 `D:\moyin\config`（标准版可再备份 `D:\moyin\redis`）。电子书目录按你自己的盘备份。

---

## 小白指南：Mac（OrbStack）

面向第一次用容器的 Mac 用户。推荐用 **[OrbStack](https://orbstack.dev/)**（比 Docker Desktop 更轻）；命令仍是 `docker` / `docker compose`。Apple Silicon（M 系列）与 Intel 均可。

> **顺序不要反：先装 OrbStack，再复制 Compose / 启动墨引。**  
> 没装好 Docker 引擎时，后面所有 `docker` 命令都会失败。

### 1. 先安装 OrbStack（必做第一步）

1. 打开 [orbstack.dev](https://orbstack.dev/) 下载、安装并启动 **OrbStack**。  
2. 菜单栏出现 OrbStack 图标、状态为运行中后，打开「终端」：

```bash
docker version
docker compose version
docker context show    # 一般是 orbstack
```

三条正常、且 `context` 为 `orbstack` 后，再进入下一步。若不是：`docker context use orbstack`。

### 2. 复制 Compose 配置并编辑

1. 新建目录：

```bash
mkdir -p ~/moyin/config ~/moyin/redis
cd ~/moyin
```

2. 用编辑器新建 `~/moyin/docker-compose.yml`，把上文 **「方式 B：标准版 Compose」** 整段 YAML **复制粘贴**进去并保存。  
3. 按需修改密码 / 密钥；把电子书路径换成 Mac 路径，例如：

```yaml
      - /Users/你的用户名/Books:/library-source
      # 外置盘常见写法：
      # - /Volumes/YourDisk/ebooks:/library-source
```

`/Users/...` 在 OrbStack 下通常可直接挂载，无需再开「文件共享」开关。

### 3. 启动与访问

```bash
cd ~/moyin
docker compose up -d
docker compose logs -f moyin
```

浏览器：`http://127.0.0.1:6173`

**首次登录：** 用户名 `admin`，密码 `change_me`（若你已在 yml 里改过 `ADMIN_PASSWORD`，则用你改后的密码）。

### 4. Mac / OrbStack 常见坑

| 坑 | 怎么避 |
|----|--------|
| 外置盘 `/Volumes/xxx` 重启后挂不上 | 先在访达打开该磁盘再 `compose up`；盘名勿随意改。路径变了要同步改 yml 与（如有）库内历史路径。 |
| 把 Mac 路径写成 Linux 虚拟机路径 | Compose 里的左侧是**宿主机（Mac）路径**，右侧才是容器内路径。不要写 OrbStack 机器内部的陌生路径。 |
| 权限 / 读不到书 | 电子书目录不要加 `:ro`；确认该文件夹对当前用户可读。 |
| 已装过 Docker Desktop 冲突 | 同一时间只用一套引擎。`docker context ls` 选 `orbstack`，或退出 Docker Desktop。 |
| Apple Silicon 拉取很慢或架构不对 | 官方镜像已是多架构。用 `docker pull streamstack/moyin:latest`，不要强行 `--platform` 错架构。 |
| 升级后数据没了 | 是否换了 `~/moyin` 目录？是否删了 `config`？数据只在你挂载的 `./config`。 |
| 本机已有 Redis 想复用 | 可用 `host.docker.internal` 指向宿主机 Redis（进阶）；新手直接用仓库标准版自带 Redis 最省事。 |
| 睡眠唤醒后容器异常 | OrbStack 一般会自动恢复；不行就 `docker compose up -d` 再拉起。 |

### 5. 升级 / 备份

```bash
cd ~/moyin
docker compose pull
docker compose up -d
```

备份：复制整个 `~/moyin/config`（标准版可再备份 `~/moyin/redis`）。

---

## 许可证

[MIT](./LICENSE) © streamstack-cn
