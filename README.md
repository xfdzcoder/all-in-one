# 个人工作台（all-in-one）

自研个人工作台（Personal Workbench）：把散落的自建服务与常用工具收进**一个可配置的桌面**——
Dashboard 布局自由拖放、组件由 manifest 声明、数据归 Workspace、凭证进加密仓库、第三方出站统一走服务端 connector。

- **技术栈**：React 19 + Vite SPA（`apps/web`）/ Fastify + Drizzle + libsql SQLite（`apps/server`）/ Widget 契约包（`packages/widget-sdk`）；pnpm monorepo。
- **需求与技术决策的唯一事实来源**：[`docs/feature-plan/`](docs/feature-plan/)（01 需求 / 02 决策 D1–D63 / 05 里程碑 / 06 路线图 / 07 迭代记录 / 08 组件质量门禁）。
- **部署与备份**：[`docs/deploy.md`](docs/deploy.md)（Docker 单镜像、Gmail OAuth、迁移回滚见 [`apps/server/drizzle/README.md`](apps/server/drizzle/README.md)）。
- **质量体检报告**：[`docs/quality-audit/`](docs/quality-audit/)（2026-10-02 全库体检：报告、台账、静态检测现状）。
- **交互文档库**：[`docs/interaction/`](docs/interaction/)（页面 / 组件 / 交互面三级，按钮总索引）。

## 快速开始

```bash
pnpm install                 # 包管理器固定 pnpm@12.6.0
export ADMIN_PASSWORD='你的口令'                 # 首启必填（D17）
export CREDENTIALS_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
pnpm dev                     # web :5173（代理 /api）+ server :3000
```

常用命令：`pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint`（oxlint + knip 门禁）。
UI 行为验收：`node apps/web/scripts/verify-*.mjs`（puppeteer-core + 系统 Chrome，需 server :3000 + preview :4173）。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `apps/web` | 前端宿主：布局引擎（gridstack，**只在这里封装**）、组件渲染、数据源管理 |
| `apps/server` | API / 鉴权 / 数据通道 / connector / 凭证加密仓库 / 迁移（drizzle-kit 生成，勿手写 DDL） |
| `packages/widget-sdk` | Widget 契约（manifest / configSchema / 插件 ABI / 受限 JSX / ServiceOverview）——**扩展规范见其 README** |
| `docs/` | 需求决策、部署、交互文档、质量体检 |
| `apps/web/scripts/` | verify/capture 脚本（布局与数据快照还原守卫，不污染开发库） |

> 维护约定、架构不变量与提交规范见 [`AGENTS.md`](AGENTS.md)。
