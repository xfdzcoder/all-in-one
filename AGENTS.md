# AGENTS.md

自研个人工作台（Personal Workbench）· pnpm monorepo，早期开发阶段。产品需求与技术决策的唯一事实来源是 `docs/feature-plan/`（全中文）。

## 工作方式（本项目硬约束）

- **阶段门控**：需求分析 → 产品定义 → 技术方案设计 → MVP 定义 → 实施。未经用户明确确认，不得进入下一阶段；文档先行于编码。不要擅自扩大需求范围。
- **质量门禁（D47）**：新增组件、接入第三方服务、改动卡片指标，必须过 `docs/feature-plan/08-widget-quality.md` 的推导顺序与 §5 DoD 清单（含真机验证），自检结果写入当轮记录。
- **需求/决策变更**：更新 `docs/feature-plan/01-requirements.md`，并向 `docs/feature-plan/02-decisions.md` 追加 `D#` 条目（ADR 风格，保留历史，不静默改写）。当前决策 D1–D75；MVP 里程碑与进度见 `05-mvp.md` / `README.md`。
- 非目标与排后组件（Kanban/邮件/监控/OpenCode、代码插件安装器、多用户/公网）见 `01-requirements.md` §1.2/§2.3，勿提前实现。新想法进 `06-roadmap.md` 待定清单。
- 提交信息用英文 conventional commits；工作区只提交代码与文档，`.idea/`、`.mimocode/` 已 gitignore。**M2 起每个小批次（子项）完成后单独一次 commit**，勿攒大提交。

## 自主迭代模式（D22，已授权）

- 迭代阶段运行自主 loop（`@bybrawe/opencode-loop`）：**豁免阶段门控的逐批确认**，每批次完成后直接 commit 并继续下一项，无需等待用户确认；授权范围与禁令见 `docs/feature-plan/02-decisions.md` **D22**。
- 每轮协议见 `.opencode/loop-prompt.md`；状态落盘 `docs/feature-plan/07-iteration-progress.md`（队列/记录/待用户确认）。
- **提交即推送（D53）**：每批次 commit 后自动 `git push origin main`。**前置条件**：该批门禁全绿（`pnpm test` / `typecheck` / `lint` + 本批涉及的 `apps/web/scripts/verify-*.mjs`，改配色另含 `verify-dark.mjs`）；任一未过或因环境跑不了 → **只 commit 不 push**，原因记 07 待办、继续下一项。push 失败（非快进/远端不可达/认证失败）→ 记 07 待办、**不阻塞**、本地 commit 保留，下批开跑前重试一次。
- **硬边界**：除上述 `git push origin main` 外，禁止任何远端外发（`opencode.jsonc` permissions 已 deny，force-push / 其它分支 / tag 仍拒）；凭证不入日志/前端明文、不入库；需要用户拍板的产品决策记入 07「待用户确认」并跳过该项。
- 停止：会话内发「停止」指令或 `/loop-stop`、`/loop-pause`（`/loop-clear` 清除）；恢复 `/loop-resume`。

## 组件/接入质量门禁（D47，硬约束）

- 推导顺序（缺一不可）：**用户问题清单（3–5 条）→ 对照物（官方 UI + 成熟 dashboard）→ 指标映射表（问题/指标/来源/降级四列）→ API 落实（多接口聚合 + 多版本回落 + 权限模型意识）→ 真机验证**。方向永远是"用户想看什么 → 去 API 找答案"，禁止"API 给什么 → 展示什么"。
- 降级文案写**原因 + 怎么修**，禁止"该服务未提供 X"式甩锅（除非确证并引用证据）。
- **真机验证**：拿得到真实实例的接入必须连真机看卡片才算完成，否则标"待真机验证"入待办、不勾完成；凭证只落 `.opencode/.env.verify`（不入库/不入日志/不进前端）。
- 完成定义 = `docs/feature-plan/08-widget-quality.md` §5 DoD 清单勾全，自检结果写入 07 当轮记录。

## 命令

- 安装：根目录 `pnpm install`（`packageManager` 固定 pnpm@12.6.0；本机无 corepack，缺 pnpm 时 `npm i -g pnpm`）
- 根脚本（覆盖三包）：`pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm test` / `pnpm typecheck`
- **`pnpm dev` 的参数只被 apps/web（vite）消费**：pnpm 会把多余 CLI 参数追加到每个子包的 dev 命令，`tsc --watch`/`node --watch` 都会丢弃它们（widget-sdk 的 dev 用 `sh -c` 包一层吞参）。所以 `pnpm dev --host` 只把 web 开到局域网（vite :5173），server 仍监听 `127.0.0.1:3000`，局域网访问 `/api` 走 vite 代理，不需要也不应该把 :3000 暴露到局域网。
- 分包：`pnpm dev:web`、`pnpm dev:server`；`pnpm --filter @all-in-one/web build` 等
- 测试：Vitest 单元/契约测试（`pnpm test`，M1/M2 起真实生效）；UI 行为验证用 puppeteer-core + 系统 Chrome，验收脚本在 `apps/web/scripts/verify-*.mjs`（需 server :3000 + preview :4173；J5 另需 `ALLOW_PRIVATE_OUTBOUND=1` 与 `CREDENTIALS_MASTER_KEY`）。**跑批入口（TST-18）**：`pnpm verify list`（清单）/ `pnpm verify smoke`（冒烟集）/ `pnpm verify <脚本名...>`——脚本公共原语在 `apps/web/scripts/lib/verify-kit.mjs`（登录/断言/口令单点，TST-14/15/17 收口）。Playwright J1–J8 已完成（05-mvp 出口标准，J 系列含 J5/J6/J7/J8）。
- `apps/server`：M1 已完成（Fastify + Drizzle + libsql(`file:` SQLite WAL, D16) + 鉴权 + Dashboard CRUD + zod/OpenAPI）。schema 见 `apps/server/src/db/schema.ts`，**迁移由 drizzle-kit 生成**（D18：`pnpm --filter @all-in-one/server exec drizzle-kit generate`，启动时自动 apply；改 schema 必须重新 generate，勿手写 DDL）。入口 `src/index.ts`（Node 26 直跑 TS，相对 import 用 `.ts`）。**首启账号必须设 `ADMIN_PASSWORD` 环境变量**（D17，否则启动失败）；凭证加密需 `CREDENTIALS_MASTER_KEY`（base64 32 字节，`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 生成）；可选 `ADMIN_USERNAME`（默认 admin）、`COOKIE_SECURE=1`（**公网/HTTPS 部署必须** —— 否则会话 cookie 明文可截获，SEC-7；未设时启动日志有强提示）、`ALLOW_PRIVATE_OUTBOUND=1`（E2E 访问本机 mock 时放行内网出站，默认拒绝 —— SEC4）。

## Monorepo 边界

- `apps/web`（`@all-in-one/web`）：React 19 + Vite SPA，布局引擎与 Widget 渲染宿主。
- `packages/widget-sdk`（`@all-in-one/widget-sdk`）：Widget 契约包（manifest / configSchema / 生命周期 / 数据通道），**扩展规范文档见其 README**（J8）。**不得反向依赖 apps**；内置组件必须按它实现。布局引擎（gridstack）只封装在 `apps/web` 内，不得泄漏进 widget-sdk。注意：此包发 `dist/`（`prepare` 自动 tsc），Node 不能消费 node_modules 里的 .ts 源码。

## 架构不变量（违反即破坏已冻结需求）

- 概念模型：**Workspace 拥有数据 / Dashboard 只拥有布局 / Widget 实例 = 视图 + 配置**（配置只引用数据）。删除页面或组件绝不删除业务数据（`01-requirements.md` §1.3）。
- 凭证与第三方出站请求全部走服务端 connector；前端只消费工作台 API。凭证加密存储，不落前端明文、不入日志；出站请求默认拒绝内网目标（SSRF 基线）。
- 手机/平板禁止布局编辑（仅浏览 + 组件内操作），布局编辑仅桌面端（D10）。
- 单用户，但 schema 须带归属字段为多用户预留（NFR5/D9）；API 用 REST + OpenAPI（明确否决 tRPC）。

## gridstack 实测注意（D12 spike 已验证 v14，文档中的 v13 已过时）

- 从 `gridstack/dist/react` 导入（包无 `exports` 字段）；`useGridStack()` 必须在 `<GridStack>` 子树内使用——工具栏等 host UI 作为 children 传入，而不是放在组件外。
- v14 API 变化：`mode: "float"` 取代 `float: true`；断点用 `columnOpts.breakpoints`，其中 `w` 是宽度**上界**（大→小排序匹配）。
- 缩放手柄默认 autohide，hover 才显现；自动化测试需先 hover 到 item 再抓 SE 手柄中心。
- **options 必须保持稳定**：wrapper 在 options 签名变化时调用 `updateOptions()` → `load(children)`，会重置未保存的布局改动。用 `useState(() => options)` 挂载期捕获一次；编辑模式切换用 `grid.enableMove/enableResize`，**不要**放进 options（如 `staticGrid`）。
- **增删组件不触发 `onChange`**（gridstack 的 change 事件只含"位置变化"），必须同时接 `onAdded`/`onRemoved` 到保存逻辑。
- **拖拽生效有 50% 碰撞规则**：移向相邻同类尺寸组件时需覆盖对方 50%+ 面积才会推挤/交换；测试拖拽用例应拖向空白区或拖够距离，否则 moveNodeCheck 返回 false（非 bug）。
- **Q43 竞态补丁（D49）**：gridstack@14.0.0 React wrapper 存在拖动中 portal 卸载竞态（渲染期 `findInGrid` 短暂查不到节点即丢弃/解绑内容 → 卡片内容消失、只剩缩放手柄），已用 `pnpm patch` 修复（`patches/gridstack@14.0.0.patch` 两处守卫：last-node 回退 + keep-previous-container）。**升级 gridstack 时必须复查该补丁是否仍需要**并重新生成；回归见 `apps/web/scripts/verify-gdrag.mjs`（多路径压测 + 确定性竞态用例）。
- 选型已冻结：gridstack 优先、react-grid-layout 仅作既定备选（切换需走决策记录），勿自研网格。
