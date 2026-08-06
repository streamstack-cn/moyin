# MoYin UX / 质量批次 Implementation Plan

> **For agentic workers:** 一步一测；每步结束后跑相关单测；行为不变优先；高风险项只做安全抽取。

**Goal:** 落地 AI 进度人话化与刷新/断线续传、请求可观测、书库找书成本、包体/缓存、E2E 与手势回归、阅读器巨页安全拆分；全流程自检。

**Architecture:** AI 会话仍以模块级 store 为准，叠加 sessionStorage 持久化「可恢复元数据」与阶段枚举；断线/刷新不伪续 SSE，改为明确「已断开 → 一点续跑」；Request-Id 贯通前后端；阅读器拆分只抽纯函数/已隔离逻辑，不改选区事件机语义。

**Tech Stack:** React + Vite、FastAPI、Vitest、Playwright、sessionStorage

## Global Constraints

- 一步一测，不引入新 bug；功能闭合；逻辑严密
- 不主动 push；不主动 commit（除非用户要求）
- 阅读器选区事件机：禁止重写行为，仅安全抽取
- F5 续传：不假装能从半截 token 续 SSE；展示断线 + 同参数重试/拉已有报告

---

### Task 1: AI 阶段 + 重试 + sessionStorage + 断线

- [x] 扩展 `AiGeneratePhase`：collecting / model / saving / disconnected
- [x] persist opts；F5 后 streaming → disconnected + 可继续
- [x] UI：阶段文案 + 失败/断线一键重试
- [x] 单测：phase 推导、persist/hydrate、sameBookIds

### Task 2: Request-Id

- [x] client 生成/透传 `X-Request-Id`；ApiError 携带
- [x] 后端 middleware 读入/回写日志
- [x] 单测或轻量验证

### Task 3: 书库找书成本

- [x] 首页/书库「继续阅读」入口更醒目；搜索入口收敛
- [x] 行为不变自检

### Task 4: Chunk + 封面缓存

- [x] build 后 chunk 备注/脚本；封面接口 Cache-Control

### Task 5: E2E 核心路径

- [x] 扩展 Playwright：登录→书库→阅读器壳→引用篮→AI（可跳过无环境）

### Task 6: 划词/手势回归单测

- [x] readerGestures / readerSelection / pageTurn 边界用例

### Task 7: Reader 巨页安全抽取

- [x] 仅抽已稳定逻辑到 lib/hooks；ReaderPage 行为零变

### Task 8: 全面自检

- [x] vitest + 相关 backend unittest + build
