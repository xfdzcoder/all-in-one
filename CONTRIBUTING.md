# 参与贡献

感谢关注个人工作台（all-in-one）。这是一个自用导向的单用户工作台，**产品需求与技术决策的唯一事实来源是 [`docs/feature-plan/`](docs/feature-plan/)**，贡献前请先浏览其中的需求与决策记录。

> **仓库形态**：源仓库托管在内部 Forgejo，**单向镜像**到 GitHub（公开）。
> GitHub 侧实质只读：Issue / 讨论欢迎，但 **PR 不会回流到源仓库**；
> 较大的改动请先开 Issue 对齐方案，由维护者移植落地（镜像同步后你仍会看到自己的署名）。
>
> **CI 只在 GitHub 镜像侧运行**（`.github/workflows/`）：Forgejo 侧由 `.forgejo/workflows/`
> 空占位目录主动让出 workflow 解析（见该目录内说明），不产生任何 CI run。

## 开发环境

- Node 26+，包管理器固定 **pnpm 12.6.0**（无 corepack 时 `npm i -g pnpm`）
- 首启需要两个环境变量（详见 [`docs/deploy.md`](docs/deploy.md)）：

```bash
pnpm install
export ADMIN_PASSWORD='你的口令'                  # 首启创建初始账号（D17）
export CREDENTIALS_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
pnpm dev                                         # web :5173（代理 /api）+ server :3000
```

## 提交前必须通过的门禁

```bash
pnpm test          # Vitest 单元/契约测试
pnpm typecheck     # 三包 tsc
pnpm lint          # oxlint + knip
```

UI 行为改动另跑相关验收脚本（puppeteer-core + 系统 Chrome，需 server :3000 + preview :4173）：

```bash
pnpm verify list          # 验收脚本清单
pnpm verify smoke         # 冒烟集
pnpm verify <脚本名...>   # 指定脚本
```

改动配色/主题时另含 `verify-dark.mjs`。CI 只跑测试与静态检查，**不跑** puppeteer 验收，请在本地自测。

## 提交约定

- 提交信息用**英文 conventional commits**（`feat:` / `fix:` / `docs:` / `test:` / `refactor:` …），一行摘要 + 必要的正文说明。
- **每个小批次（子项）单独一次 commit**，不要攒大提交。

## 需求与决策变更

- 新需求/行为变更：先在 Issue 讨论对齐 → 更新 [`docs/feature-plan/01-requirements.md`](docs/feature-plan/01-requirements.md)，并向 [`docs/feature-plan/02-decisions.md`](docs/feature-plan/02-decisions.md) 追加 `D#` 条目（ADR 风格：背景/决策/影响/被否备选，**保留历史、不静默改写**）。
- 先读非目标清单（`01-requirements.md` §1.2/§2.3）：多用户、公网化、Kanban/邮件/监控等排后项勿提前实现；新想法进 [`06-roadmap.md`](docs/feature-plan/06-roadmap.md) 待定清单。
- **新增组件 / 接入第三方服务 / 改动卡片指标**：必须过 [`08-widget-quality.md`](docs/feature-plan/08-widget-quality.md) 的质量门禁（用户问题清单 → 对照物 → 指标映射 → API 落实 → 真机验证）。

## 架构不变量（违反即破坏已冻结需求）

- **概念模型**：Workspace 拥有数据 / Dashboard 只拥有布局 / 组件实例 = 视图 + 配置；删除页面或组件绝不删除业务数据。
- **凭证与出站**：凭证加密存储，不落前端明文、不入日志；第三方出站请求全部走服务端 connector，默认拒绝内网目标（SSRF 基线）。
- **Monorepo 边界**：布局引擎（gridstack）只封装在 `apps/web`；`packages/widget-sdk` 不得反向依赖 apps，内置组件必须按它实现。
- **移动端**：仅浏览与组件内操作，布局编辑仅桌面端。
- **schema**：单用户，但表结构须带归属字段为多用户预留。

更完整的维护约定见 [`AGENTS.md`](AGENTS.md)。

## 发布约定

- 版本号遵循语义化版本，用户可见变更记入 [`CHANGELOG.md`](CHANGELOG.md)。
- 打 `v*` tag 后由 CI 自动创建 GitHub Release 并推送镜像到 GHCR（见 `.github/workflows/docker.yml`）。
