# AGENTS.md

自研个人工作台（Personal Workbench）· pnpm monorepo，早期开发阶段。产品需求与技术决策的唯一事实来源是 `docs/feature-plan/`（全中文）。

## 工作方式（本项目硬约束）

- **阶段门控**：需求分析 → 产品定义 → 技术方案设计 → MVP 定义 → 实施。未经用户明确确认，不得进入下一阶段；文档先行于编码。不要擅自扩大需求范围。
- **需求/决策变更**：更新 `docs/feature-plan/01-requirements.md`，并向 `docs/feature-plan/02-decisions.md` 追加 `D#` 条目（ADR 风格，保留历史，不静默改写）。当前决策 D1–D15；MVP 里程碑与进度见 `05-mvp.md` / `README.md`。
- 非目标与排后组件（Kanban/邮件/监控/OpenCode、代码插件安装器、多用户/公网）见 `01-requirements.md` §1.2/§2.3，勿提前实现。新想法进 `06-roadmap.md` 待定清单。
- 提交信息用英文 conventional commits；工作区只提交代码与文档，`.idea/`、`.mimocode/` 已 gitignore。

## 命令

- 安装：根目录 `pnpm install`（`packageManager` 固定 pnpm@12.6.0；本机无 corepack，缺 pnpm 时 `npm i -g pnpm`）
- 根脚本（覆盖三包）：`pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm test` / `pnpm typecheck`
- 分包：`pnpm dev:web`、`pnpm dev:server`；`pnpm --filter @all-in-one/web build` 等
- 测试：尚无 runner（计划 M2 Vitest 契约测试、M3 Playwright J1–J4）；`test` 脚本目前为占位。UI 行为验证可用系统 Chrome（`/usr/bin/google-chrome`）+ puppeteer-core 驱动（M0 spike 即如此做的拖拽/缩放/断点验证）。
- `apps/server` 为 M1-① 占位（入口 `src/index.ts`，Node 26 可直接跑 TS）；Fastify + Drizzle 在 M1-②。

## Monorepo 边界

- `apps/web`（`@all-in-one/web`）：React 19 + Vite SPA，布局引擎与 Widget 渲染宿主。
- `packages/widget-sdk`（`@all-in-one/widget-sdk`）：Widget 契约包（manifest / configSchema / 生命周期 / 数据通道），当前为占位。**不得反向依赖 apps**；内置组件必须按它实现。布局引擎（gridstack）只封装在 `apps/web` 内，不得泄漏进 widget-sdk。

## 架构不变量（违反即破坏已冻结需求）

- 概念模型：**Workspace 拥有数据 / Dashboard 只拥有布局 / Widget 实例 = 视图 + 配置**（配置只引用数据）。删除页面或组件绝不删除业务数据（`01-requirements.md` §1.3）。
- 凭证与第三方出站请求全部走服务端 connector；前端只消费工作台 API。凭证加密存储，不落前端明文、不入日志；出站请求默认拒绝内网目标（SSRF 基线）。
- 手机/平板禁止布局编辑（仅浏览 + 组件内操作），布局编辑仅桌面端（D10）。
- 单用户，但 schema 须带归属字段为多用户预留（NFR5/D9）；API 用 REST + OpenAPI（明确否决 tRPC）。

## gridstack 实测注意（D12 spike 已验证 v14，文档中的 v13 已过时）

- 从 `gridstack/dist/react` 导入（包无 `exports` 字段）；`useGridStack()` 必须在 `<GridStack>` 子树内使用——工具栏等 host UI 作为 children 传入，而不是放在组件外。
- v14 API 变化：`mode: "float"` 取代 `float: true`；断点用 `columnOpts.breakpoints`，其中 `w` 是宽度**上界**（大→小排序匹配）。
- 缩放手柄默认 autohide，hover 才显现；自动化测试需先 hover 到 item 再抓 SE 手柄中心。
- 选型已冻结：gridstack 优先、react-grid-layout 仅作既定备选（切换需走决策记录），勿自研网格。
