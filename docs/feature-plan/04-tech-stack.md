# 技术方案选型（冻结）

> 状态：**冻结**（2026-09-28，决策 D11–D14）。对比过程见 [03-tech-analysis.md](03-tech-analysis.md)。

## 1. 总体架构

```
浏览器 SPA (React + TS)
   │  仅访问工作台 REST API + SSE（凭证与第三方出站请求永不过前端）
   ▼
后端单体 (Node.js + TS, Fastify)
   ├── 鉴权/会话（httpOnly Cookie）
   ├── Widget 数据通道（统一取数/缓存/限流/刷新调度）
   ├── Connector 层（RSS / HTTP 探测 / 自定义 API 代理 / …）
   ├── Credential Store（AES-256-GCM 加密，主密钥来自环境变量/密钥文件）
   └── SQLite (WAL)（布局、配置、Workspace 业务数据、凭证密文）
```

与需求对应：SEC3/SEC4 由"统一数据通道"满足；D9 落在表结构归属字段 + 单体分层清晰可拆。

## 2. 选型总表

| 选型点 | 冻结选择 | 为什么适合本项目 | 替代方案（被否/备选） | 主要风险与缓解 |
|---|---|---|---|---|
| 前端框架 | **React 18/19 + TypeScript + Vite（SPA）** | Widget/插件生态与动态组件加载最成熟（D4/D7）；类型可与后端/插件 SDK 共享 | Vue 3（可行，生态略小）；Svelte（插件生态弱）；SSR 框架（无 SEO，不采用） | 无硬风险 |
| 布局引擎 | **gridstack.js（官方 React wrapper，实测 v14）** | dashboard 专建；断点列数自动重排（D6）；save/load 原生；Homarr 生产验证 | react-grid-layout（**既定备选**，见 §3） | wrapper 较新 → **M0 spike 已通过（2026-09-28，7/7）**，风险解除；v14 API 差异记录于 D12 |
| UI 组件库 | **Mantine** | 表单/弹层/暗色/通知开箱即用，configSchema 配置表单（FR-W2）开发快；Homarr 同款可借鉴 | shadcn/ui + Tailwind（轻量可控）；AntD（重） | 包体积略大，可接受 |
| 后端 | **Node.js + TypeScript + Fastify（模块化单体）** | 全栈 TS = Widget 契约单一来源（D11 最大红利）；OpenCode SDK 原生 TS（未来）；imapflow 最佳 IMAP 库；单人一种语言 | NestJS（重）；Go（双语言 + 契约成本）；Python/FastAPI（契约共享弱） | Node 单线程（个人规模无感） |
| API 风格 | **REST + OpenAPI（zod 定义 schema）** | 插件/第三方集成需语言无关稳定契约 | tRPC（锁死 TS 插件）；GraphQL（过度设计） | 无硬风险 |
| 数据库/ORM | **SQLite（WAL）+ Drizzle ORM** | 单用户零运维、备份=拷文件；Drizzle 轻量 TS 原生，**同一 schema 可迁 Postgres**（多用户迁移路径） | PostgreSQL（现阶段过度设计）；Prisma（重）；Kysely（亦可） | SQLite 并发弱（单用户无感） |
| 鉴权 | **会话 Cookie（httpOnly + SameSite）+ argon2id** | SEC1 满足；易撤销、易加多用户（session 表带归属） | JWT（撤销难无收益）；SSO/OAuth（暂不考虑） | 无硬风险 |
| 数据通道/实时 | **TanStack Query + SSE（失效通知）** | FR-I3/I6：统一刷新节流 + 事件推送；比 WebSocket 简单够用 | 纯轮询（兜底已有）；WebSocket（双向无需求） | SSE 连接数 = 标签页数，个人规模无感 |
| Widget 契约工程化 | **pnpm monorepo：`apps/web` / `apps/server` / `packages/widget-sdk`** | widget-sdk 是 D4/D7 落地物：manifest 类型、configSchema 约定、生命周期接口、渲染 props 契约；内置组件也按它实现（J8） | 全部塞单包（规范无处安放，二期重构） | 包边界纪律：widget-sdk 不得反向依赖应用 |
| 自定义 API 渲染 | **声明式白名单模板**（预设：统计卡片/列表/状态点/原始 JSON + 白名单模板变量） | 零代码覆盖长尾且无代码执行风险（SEC5/D14） | 受限 JS/JSX（二期可升级）；仅 Raw JSON（太弱） | 复杂 API 表达力有限 → Raw JSON 兜底 |
| 部署 | **单镜像（Node 伺服 API + 静态资源）+ docker-compose** | 个人自托管最简；备份 = SQLite + 数据卷 | 前后端两容器（无必要）；k8s（不采用） | 无硬风险 |
| 测试 | **Vitest（单元/契约）+ Playwright（旅程 J1–J4）** | 契约测试守住 widget-sdk；旅程测试守住布局持久化 | — | — |

## 3. 布局引擎对比（K1 收敛）

D6（单一布局自动重排）+ D10（禁移动编辑）后差距收窄：

| | gridstack.js | react-grid-layout |
|---|---|---|
| 断点重排 | `columnOpts` 断点列数 + relayout 策略 | 断点布局可从单一布局插值生成 |
| 保存/恢复 | 原生 `save()/load()` | 自行序列化（成熟惯用法） |
| 触屏 | 原生（已非需求） | 弱（已非需求） |
| 产品先例 | Homarr（fork 使用） | BitMEX 等 dashboard |
| 结论 | **首选**（D12） | **备选**，spike 不合格即切换 |

**关键隔离点：** 布局引擎封装在 `apps/web` 内部，不泄漏进 widget-sdk 契约，两条路架构均允许。

## 4. 对后续扩展的影响

- **D7 二期代码插件**：widget-sdk 契约 + REST/OpenAPI 意味着插件可不依赖构建工具链；加载器（iframe 沙箱 / Web Component）只影响 `apps/web` 运行时，不动核心。
- **D9 多用户/公网**：Drizzle schema 自带归属字段可迁 Postgres；会话模型带 user 归属；REST 无状态易加限流/审计中间件。
- **排后组件**：邮件 → imapflow connector；OpenCode → TS SDK 薄封装 + 版本探测；监控 → 独立 connector（来源产品期定）；Kanban → 纯 Workspace 数据 + 前端组件，不动核心。

## 5. 技术风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| gridstack React wrapper 不成熟 | 中 | MVP M0 spike + RGL 备选切换预案（D12） |
| Widget 契约设计不好导致二期插件重构 | 中 | widget-sdk 从第一行代码独立成包；内置组件即第一个"插件"（J8） |
| 自定义 API 模板表达力不足 | 低 | Raw JSON 兜底；二期升级受限 JS 模板 |
| SQLite 未来迁移 | 低 | Drizzle 双方言 schema，迁移路径明确 |
| Mantine/React 大版本升级 | 低 | 常规依赖管理 |
