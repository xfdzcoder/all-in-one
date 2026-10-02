# 静态检测器现状（Q95 分区 E 自执行 / Q96 落地面）

> 对应用户要求「**引入 lint 工具做静态检测**」与拍板④（强化 oxlint + knip + `pnpm audit`，不引 ESLint）。
> 本文件是**活文档**：Q96 清零过程中持续更新。

## 1 · oxlint（已开足 2026-10-02；**Q96a 清零 160 条：242 → 82**）

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


## 4 · Q96a 清零记录（2026-10-02）

- **定向豁免 6 类**（每条都有理由，不是逃逸）：
  - `oxc/no-async-endpoint-handlers`：**Express 规则**，Fastify 的 async handler 是官方推荐形态（11 处误报）；
  - `import/no-named-as-default-member`：全仓统一 `import X from` + `X.fn` 惯例（40 处全是同一形态，如 `puppeteer.launch`）；
  - `import/no-unassigned-import`：副作用 CSS 导入是 Vite 标准用法；
  - `eslint/no-await-in-loop`：分页/顺序语义**有意为之**（可并行的抓取已在 Q99a 改 `mapLimit`）；
  - `eslint/no-underscore-dangle`：外部 schema/既有 API 字段命名（非本库可控）；
  - `react/only-export-components`：组件与纯函数同文件是既有组织方式（fast-refresh 提示而已）。
- **机械清理**：`sort→toSorted` ×16、spread 冗余兜底 ×6、未用变量 ×10、`on*=`→`addEventListener` ×6、`promise(always-return)` ×5、`no-new-array` ×2、`filter+pop→findLast`、`includes→Set.has`、默认数组字面量→常量、循环累积 spread→原地推进。
- **顺带修掉的真问题**：① 3 处 **fetch GET 带 body**（违反 fetch 规范，会被忽略或抛 TypeError；含 `verify-gallery-live` 的 api() 助手）；② 2 处 catch 重抛**丢 cause**（错误链断裂，已补 `{ cause: err }`）；③ 死代码/死参数清理。
- **余下 82 条（Q96b）**：`eslint(no-shadow)` 27、`unicorn(consistent-function-scoping)` 26、`react(no-array-index-key)` 9、`oxc(no-map-spread)` 9、react singles 4（`set-state-in-effect`/`refs`/`immutability`/`jsx-no-constructed-context-values` —— 后三者含**潜在真 bug**，需逐个看上下文再改）。Q96b 清零后把 categories 升格 `error` 并引入 knip（LNT-3）。


## 5 · Q96 收口（2026-10-02，四批全清）

- **categories 升格 `error`**（correctness/suspicious/perf）——存量清零后，**未来违规直接红**（入 D53 门禁）。
- **knip 入 `pnpm lint` 门禁**（`pnpm -r lint && knip`）：零发现为常态，回归即红。
- **产品侧 no-shadow/scoping 全修**（9 处：含 `config` 参数遮蔽全局 app config 的真混淆源、`sr`/`nextId`/`userId`/`pluginsRoot`/`summarize` 纯函数上提）；脚本/测试的旅程级闭包与短回调名**定向豁免**（局部惯用法）。
- **余量 15 条 jsx-a11y 保 warn**（A11Y-1，P2 专项）：`prefer-tag-over-role` 与既有「复杂行 `div role=button`」模式冲突（换真 button 会重新引入 WEB-3 嵌套交互元素问题，需专门设计）、遮罩点击已有 Esc/焦点路径、composer autoFocus 有意为之。
- **教训留档**：上提纯函数时**必须原样剪切**——本轮 `summarize` 首版被重写（丢省略号与对象过滤语义），靠 `git diff` 复核抓回并恢复原实现。


## 6 · 构建产物体积实测（DOC-28 / ⑪，2026-10-02 基线）

> 这是 **ECharts 引入前**的基线（批 H/Q75 尚未开工）—— D55 要求的「构建体积收口复核」以此为对照。

| 产物 | 原始 | 说明 |
|---|---|---|
| `assets/index-*.js` | **1050 KB** | 单 chunk（当前无路由级分包），gzip 后整包 js/css/html ≈ **352 KB** |
| `assets/index-*.css` | 262 KB | 含 Mantine 组件样式 + `--wb-*` 令牌表 |
| 字体（Inter variable ×5） | ≈190 KB | `@fontsource-variable/inter`（latin/latin-ext/cyrillic/greek） |
| 其余（品牌 SVG/PNG 等） | ≈40 KB | vendored 图标（D45） |
| **dist 合计** | **1555 KB** | |

观察：① JS 单 chunk 1050KB 是体积主项（Mantine + react + gridstack + 表格/图表类组件全量打入）；② ECharts 按需注册（D55）落地时以此为对照，预期增量 <150KB；③ 若后续要瘦身，优先方向 = 路由级/组件级懒加载（组件表 `widget-registry` 的组件可按需动态 import）。
