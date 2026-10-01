# 静态检测器现状（Q95 分区 E 自执行 / Q96 落地面）

> 对应用户要求「**引入 lint 工具做静态检测**」与拍板④（强化 oxlint + knip + `pnpm audit`，不引 ESLint）。
> 本文件是**活文档**：Q96 清零过程中持续更新。

## 1 · oxlint（已开足，2026-10-02）

- 三份 `.oxlintrc.json` 已从「2 条 react 规则」扩到 **plugins：typescript/oxc/react/import/jsx-a11y/unicorn/promise + categories：correctness/suspicious/perf 全开**（暂以 warn 落地，保证 `pnpm lint` exit 0；Q96 清零后逐类升 error）。
- 豁免（有理由，勿回退）：
  - `react/react-in-jsx-scope: off` —— React 19 automatic JSX runtime，该规则 841 条全是误报；
  - `scripts/**` 关 `eslint/no-await-in-loop` —— 验收脚本的步骤本就顺序执行。
- **存量清单（1100+ warning，按规则聚类）**：

| 规则 | 条数 | 定性 | 处置 |
|---|---|---|---|
| `react(react-in-jsx-scope)` | 841 | 误报（已关） | — |
| `eslint(no-await-in-loop)` | 73 | 多为脚本/分页顺序语义 | src 侧复核（Q96） |
| `import(no-named-as-default-member)` | 40 | 风格 | P2 批 |
| `unicorn(consistent-function-scoping)` | 26 | 风格/可读性 | P2 批 |
| `eslint(no-shadow)` | 22 | **有真 bug 风险** | Q98/Q99 复核 |
| `unicorn(no-array-sort)` | 14 | 现代化（`toSorted`） | P2 批 |
| `eslint(no-underscore-dangle)` | 12 | 风格 | P2 批 |
| `oxc(no-async-endpoint-handlers)` | 11 | Fastify 语义复核 | Q100 |
| `eslint(no-unused-vars)` | 10 | **死代码** | Q96 清零 |
| `react(no-array-index-key)` | 9 | 潜在渲染缺陷 | Q99 复核 |
| `oxc(no-map-spread)` | 9 | 性能 | P2 批 |
| `unicorn(prefer-add-event-listener)` / `no-useless-fallback-in-spread` / `promise(always-return)` / `import(no-unassigned-import)` / `unicorn(no-invalid-fetch-options)` / `preserve-caught-error` 等 | 5+5+5+4+3+2 | 混合（`no-invalid-fetch-options` 可能是真 bug） | Q99/Q100 复核 |
| `jsx-a11y/*` | 14 | **a11y（维度⑦）** | Q100（键盘/标签） |
| `react(only-export-components)` / 其余 | 4+ | 风格 | P2 批 |

## 2 · knip（未引入 —— Q96 待办）

- 目标：死代码 / 未用导出 / 未用依赖 / 未引用文件四类守卫；配置建议 = 各包 entry 显式（`src/main.tsx`、`src/index.ts`、`scripts/*.mjs`）、ignore `dist/`、`apps/server/data/**`。
- 人工预扫（14 分区报告 LNT-3）：当前恰好没有死代码/未用依赖，但**无工具兜底**。

## 3 · `pnpm audit`（供应链）

- **1 条 moderate**：`esbuild <=0.24.2`（GHSA-67mh-4wv8-2f99，dev 链经 `drizzle-kit → @esbuild-kit/*`）；`--prod` 干净。处置：等 drizzle-kit 上游升级，Q100 记录跟踪。
- gridstack 补丁：`patches/gridstack@14.0.0.patch`（Q43 竞态两处守卫）**仍必要、未过期**（当前 latest=14.0.0）；但 `apps/web/package.json` 声明 `^14.0.0` —— 上游发 14.0.1+ 时补丁会**静默失效**（DEP-2，Q100 修：锁精确版本或加 patch 失效检测）。
