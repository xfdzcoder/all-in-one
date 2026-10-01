# 14 · 依赖 / 供应链 / 安全 / 静态检测（分区评估）

> 评估时间 2026-10-02，只读评估（未改任何产品代码/文档、未 commit/push、未安装或升级依赖）。
> 覆盖维度：① 依赖与供应链、⑥ 安全复审、② 类型安全、lint 落地面（oxlint/knip）、⑪ 构建体积（部分）。
> 证据均为实测命令输出摘要或 `文件:行`；报告不含任何凭证/密钥/token 明文。

## 1 · 命令证据摘要

- **`pnpm audit`（根 + 三包，输出一致）**：共 1 条 **moderate**——`esbuild <=0.24.2`（GHSA-67mh-4wv8-2f99，dev server 可被任意站点读响应），路径 `apps__server>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild`，修复版本 `>=0.25.0`（**有可用修复**）。4 个工作区显示的「1 vulnerabilities」是同一条的重复计数。
- **`pnpm audit --prod`**：`No known vulnerabilities found` → 该漏洞**纯 dev 链**（drizzle-kit 仅迁移用），不进生产运行时。
- **lockfile 一致性**：`pnpm-lock.yaml:168` 起的 importers 与三份 package.json 的 specifier 逐条一致（apps/server、apps/web、packages/widget-sdk 均匹配）；`:4` 处的另一个 importers 段是 pnpm 12 自管理（packageManager 自举）段，非缺陷。`:164` `patchedDependencies: gridstack@14.0.0: 5189ddb8…` 在账。
- **gridstack 补丁状态**：补丁已在 `apps/web/node_modules/gridstack/dist/react/` 生效（`gridstack-item.js:58` 为补丁后行、`gridstack.js:26,57,257,259` 为 lastNodeRef 补丁行，均含 `Q43 patch` 注释）；npm registry `gridstack@latest` = **14.0.0**（2026-10-02 查询 registry.npmjs.org）→ 补丁**未过期、仍必要**（上游无更高发布版，14.0.0 原始 dist 仍是旧竞态逻辑，修复未合入上游）。
- **依赖使用扫描**：197 个源文件 / 30,947 行；全部声明依赖均有真实引用（`@playwright/test`→`apps/web/e2e/journeys.spec.ts`、`drizzle-kit`→`drizzle.config.ts`、`@types/mailparser` 为类型包、`fflate`→`plugin/package.ts`、`acorn`/`acorn-jsx`→`widget-sdk/src/jsx-template.ts`、`@fontsource-variable/inter`→`main.tsx` 等），未发现死依赖；也未发现未声明却被源码引用的包。
- **类型安全快照**：非测试源码中 `any`/`as any`/`as unknown as` 仅 **2 处**，`@ts-ignore`/`@ts-expect-error` **0 处**。

## 2 · 台账

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| DEP-1 | `apps/server/package.json`（devDependencies: drizzle-kit）；`pnpm audit` 输出 | `esbuild <=0.24.2` 中危（GHSA-67mh-4wv8-2f99）经 `drizzle-kit>@esbuild-kit/*` 进入 dev 依赖树；`pnpm audit --prod` 干净，但 `pnpm audit` 会持续报警、污染门禁观感。有可用修复（esbuild >=0.25.0） | P2 | 升级 drizzle-kit 到已换掉 `@esbuild-kit/*` 的版本；若上游未修，用 `pnpm.overrides` 强制 `esbuild>=0.25` 后实测 `drizzle-kit generate` 可用；也可在 CI 只对 `--prod` 设硬失败、dev 告警留痕 |
| DEP-2 | `apps/web/package.json:33`（`"gridstack": "^14.0.0"`）；`pnpm-lock.yaml:164` | Q43 补丁按**精确版本** `gridstack@14.0.0` 记账，但声明是 `^14.0.0` 范围。一旦 gridstack 发布 14.0.1+，新环境解析到新版本时 `patchedDependencies` 不会应用到它 → 拖动竞态（卡片内容消失）静默回归，且 `verify-gdrag.mjs` 若未跑则无人发现。当前 latest=14.0.0 尚未触发 | P1 | 把声明钉死 `"gridstack": "14.0.0"`（精确）；或在 AGENTS.md 升级复查约定上加自动守卫：CI 检查 `node_modules/gridstack` 内存在 `Q43 patch` 注释，缺失即失败。升版时用 `pnpm patch gridstack@<新版本>` 重生成补丁并重跑 `verify-gdrag.mjs` |
| DEP-3 | `apps/server/package.json` / `apps/web/package.json` / `packages/widget-sdk/package.json` | 版本声明与实装漂移：`typescript ~6.0.2`→实装 6.0.3、`oxlint ^1.81.0`→1.85.0、`@types/node ^24.13.3`→24.19.0、`react ^19.2.8`→19.3.0。均在 semver 范围内、全仓同名包无多版本重复（typescript/oxlint/vitest/@types/node 全树单版本），属卫生问题 | P2 | 常规依赖滚动时用 `pnpm up --interactive` 对齐声明值；可选加 `pnpm dedupe` 周期任务。非紧急 |
| SEC-1 | `apps/server/src/connector/ssrf.ts:28-42`（isPrivateIp） | 内网段判定漏项 → SSRF 基线「默认拒内网」有绕过空档：① IPv6 link-local 只判 `startsWith("fe80")`，而 fe80::/10 实含 fe80–febf（`fe81::1`/`fe90::1`/`febf::1` 均通过）；② IPv6 组播 `ff00::/8`、站点本地 `fec0::/10` 未拒；③ IPv4 缺 `100.64.0.0/10`（CGNAT/Tailscale，自托管场景真实内网）、`192.0.0.0/24`、`198.18.0.0/15`、文档段。`a >= 224` 已拦 IPv4 组播/保留，IPv6 无对应 | P1（严格口径属「SSRF 绕过」类，可上调 P0；实际利用需 DNS 解析结果恰好落在上述段，故本报告按 P1 记） | 改为前缀/位段判定：IPv6 按首 10 位判 fe80::/10、拒 ff00::/8、fec0::/10；IPv4 增 100.64/10、192.0.0.0/24、198.18/15 等；在 `ssrf.test.ts` 补表格用例（每段正/反例） |
| SEC-2 | `apps/server/src/connector/registry.ts:96-103`（outboundRequest） | `maxBytes` 上限在 `await res.arrayBuffer()` **全量缓冲之后**才校验（`bytes.byteLength > maxBytes` 才抛）——超大响应仍被完整读入内存再丢弃，体积上限对内存打爆/DoS 形同虚设；随后还全量 `TextDecoder().decode` | P1 | 改用 `res.body` reader 流式累计，超过 maxBytes 立即 `abort()`；或先读 `content-length` 快速拒绝，再流式兜底 |
| SEC-3 | `apps/server/src/connector/ssrf.ts:44-100` + `registry.ts:94-101` | DNS rebinding TOCTOU：`assertSafeOutboundUrl` 解析并校验 IP 后，`fetch(url)` 会**再次**解析 DNS，两次解析之间可翻转到内网 IP。`redirect: "manual"` 已封重定向绕过（registry.ts:101），但重解析窗口未封。单用户自托管场景利用门槛高 | P2 | 校验后按已验证 IP 发请求（undici Agent 自定义 `lookup` 固定解析结果，或 IP 直连 + Host 头），把「校验结果」与「实际连接目标」绑定 |
| SEC-4 | `apps/server/src/connector/ssrf.ts:35`（`SSRF blocked for ${target}`）→ `apps/server/src/data/routes.ts:126`、`apps/server/src/mail/service.ts:227`、`apps/server/src/mail/routes.ts:190` | 错误文案内嵌**完整 target URL**，经 502/400 响应体与日志外发。若 custom-api 配置的 URL 带 `?apikey=…` 查询密钥或 `user:pass@` 基本认证（常见 API 形态），密钥即进入日志/响应——与 NFR6 脱敏及 `navidrome-library.ts:98`「口令不入 URL 日志」的既有意图冲突（该处特意用 salt+md5 就是为了不落明文） | P1 | 错误/日志中的 URL 统一走脱敏函数：去掉 userinfo、query 值打码（保留键名）；或文案只保留 origin。对 `feed/connector.ts:132` 等透传 `err.message` 的路径同样生效 |
| SEC-5 | `apps/server/src/connector/registry.ts:66-73`（cacheKeyOf）；消费点 `apps/server/src/data/routes.ts:77` | `JSON.stringify(query.config, Object.keys(query.config).sort())` 传的是 **replacer 数组**，只序列化顶层键 → 嵌套的 SecretRef `{credentialRef}`（`packages/widget-sdk/src/config.ts:53`）被序列化为 `{}`。仅 credentialRef 不同的两个 widget 配置哈希相同 → 缓存 key 碰撞：A 凭证拉的数据被 B widget 命中（跨凭证数据串用/缓存污染），force 刷新亦无法分离 | P1 | 稳定序列化整个 config（递归键排序后 JSON.stringify，或直接 `JSON.stringify(query.config)` 加显式键排序预处理），确保 credentialRef 参与哈希；补一条「同 url 不同 credentialRef → 不同 key」的单测 |
| SEC-6 | `apps/web/src/plugin-frame.tsx:72-83,107` | 插件沙箱 srcdoc CSP 为 `script-src 'nonce-${nonce}' data:`——`data:` 同时放行使 nonce 对「非内联脚本源」失去白名单意义；当前被 `sandbox="allow-scripts"`（无 allow-same-origin，不透明源）兜底，故列为加固项而非漏洞。随机 nonce/挂载生成的做法本身正确 | P2 | 把插件代码直接并入 nonce 内联 bootstrap（`buildBootstrap(code)` 已是内联脚本），去掉 `script-src` 的 `data:`；如需保留模块语义，改用 blob: 并继续禁止 data: |
| SEC-7 | `apps/server/src/auth/routes.ts:24-29` | 会话 cookie：`httpOnly: true`、`sameSite: "lax"` 正确；`secure: process.env.COOKIE_SECURE === "1"` 默认关闭（注释自述 LAN/HTTP MVP 有意）。HTTPS/公网部署若忘配则 cookie 可被明文通道截获 | P2 | 部署文档/启动日志强提示公网必须 `COOKIE_SECURE=1`；或检测 `PUBLIC_DIR`+反代头自动建议；后续支持 HTTPS 时改为默认 secure |
| LNT-1 | `apps/server/.oxlintrc.json`、`packages/widget-sdk/.oxlintrc.json`（均 `rules: {}`）；`apps/web/.oxlintrc.json`（仅 2 条 react 规则） | 三份配置两份空规则集，实际只在 web 开了 `react/rules-of-hooks` + `react/only-export-components`；server/sdk 连 typescript/oxc 插件的规则也没开（oxlint 默认仅 correctness 一小批），静态检测面远窄于已拍板的「强化 oxlint」目标 | P2 | 按 §3 建议规则集开启；三份配置合并为根 `.oxlintrc.json` + 子包覆盖，消除漂移 |
| LNT-2 | `apps/web/src/jsx-template.tsx:28`（`Record<string, ComponentType<any>>`）、`apps/web/src/service-overview-widget.tsx:149`（`data as unknown as ServiceOverview`） | 全仓仅存的 2 处类型断言逃逸：前者抹掉所有组件 props 类型；后者双重断言绕过 zod/类型收窄，`data` 形状变了不会有任何报错 | P2 | `ComponentType<Record<string, unknown>>` 或收窄为实际组件 props 联合；`as unknown as` 改为运行时 parse（zod）后再收窄 |
| LNT-3 | 全仓（knip 未引入） | 死代码/未用导出/未用依赖无守卫（本次人工扫描恰好干净，但无工具兜底，回归无拦截）；用户已拍板引入 knip | P2 | 按 §4 配置落地，`pnpm lint` 串联 `knip`，先 `--reporter json` 留基线再收紧为 error |

## 3 · oxlint 规则集建议（LNT-1 落地面）

在 `apps/web` 现有 2 条 react 规则基础上，建议按下列开启（oxlint 规则名以 `npx oxlint --rules` 为准；本机未联网核对版本差异，个别规则名可能随 1.85 有出入）：

| 分类 | 建议开启 | 理由 |
|---|---|---|
| correctness（全开，设 error） | `no-undef`、`no-unreachable`、`no-constant-condition`、`no-dupe-keys`、`no-dupe-args`、`no-func-assign`、`no-constant-binary-expression`、`no-self-compare`、`no-await-in-loop`（warn） | 真 bug 类，零理由不开；本仓 async 串联多（connector 聚合），`no-await-in-loop` 能提示可并行点（⑤ 抓取并发相关） |
| suspicious（全开，error/warn 分级） | `no-console`（warn，白名单 server 启动日志）、`no-eval`、`no-implied-eval`、`no-new-func`、`no-throw-literal`、`no-async-promise-executor`、`no-promise-executor-return`、`prefer-const`、`no-var` | 插件/模板链路（jsx-template、plugin bootstrap）最需要禁 eval 系；`no-throw-literal` 让 catch 分支的 `instanceof Error` 判断不再漏 |
| typescript 插件 | `no-explicit-any`（warn 起步）、`no-non-null-assertion`（warn）、`consistent-type-imports`（warn）、`no-unused-vars`（含 `_` 前缀豁免，error） | 现状仅 2 处 any，warn 即可守住回潮；仓库已用 `import type` 风格，`consistent-type-imports` 顺水推舟 |
| import | `no-duplicate-imports`、`no-self-import`、`no-cycle`（warn） | monorepo 三层（web→sdk←server）最怕反向依赖与循环（AGENTS.md 明令 sdk 不得依赖 apps），`no-cycle` 是这条架构约束的机器守卫 |
| performance | `no-await-in-promise-methods`、`prefer-object-spread`、`no-array-await`? （以 `--rules` 实名为准） | 收益一般，warn 级即可 |
| react（web 包） | 现有 2 条保留，补 `react/no-unstable-default-props`? 与 hooks 系列（`react-hooks/rules-of-hooks` 已有） | AGENTS.md 已记录 gridstack options 稳定性坑，hooks 相关错误成本最高 |

预估清理量：correctness/suspicious 全开对 30,947 行源码约新增 **30–60 条** warning（`no-await-in-loop` 与 `no-console` 占大头）；typescript `no-explicit-any` 现存 2 处；`no-unused-vars` 需先清零（存量约 0–10 条）。建议分两批：先 correctness+suspicious（error），再 import/typescript（warn→error）。

## 4 · knip 配置建议（LNT-3 落地面）

```jsonc
// knip.json（根）
{
  "workspaces": ["apps/*", "packages/*"],
  "entry": [
    "apps/server/src/index.ts",
    "apps/web/src/main.tsx",
    "apps/web/scripts/*.mjs",        // verify 脚本是入口
    "apps/web/e2e/**/*.spec.ts",     // playwright
    "apps/server/drizzle.config.ts",
    "**/*.test.ts"                   // vitest 由 knip vitest 插件识别亦可
  ],
  "project": ["**/src/**", "**/*.ts", "**/*.tsx"],
  "ignore": ["dist/**", "data/**", "patches/**"],
  "ignoreDependencies": ["@types/mailparser", "typescript"], // 类型/工具链
  "rules": { "dependencies": "error", "unlisted": "error", "unusedExports": "warn", "unresolvedImports": "error" }
}
```

要点：① `@all-in-one/widget-sdk` 是 workspace 包，`ignoreDependencies` 或配 workspaces 关联，勿报 unused；② `prepare: tsc` 的 dist 产物不是入口；③ 先以 warn 跑一轮留基线，再把 dependencies/unlisted 提为 error 进 `pnpm lint`。

## 5 · 核验通过项（无台账条目）

- `pnpm audit --prod` 干净；无 prod 依赖漏洞。
- lockfile 与三份 package.json 完全一致；`patchedDependencies` 哈希在账；全仓同名依赖无多版本重复。
- 凭证链路抽查：`credentials/crypto.ts` AES-256-GCM（iv+tag 随文、主密钥只读 env）、`store.ts` `toView` 只出 id/name/kind/时间戳、`readSecret` 注释与实现一致（明文仅返回给 connector）；`app.ts:47-59` 日志 redact 覆盖 authorization/cookie 与 body 的 password/secret/apiToken/token；`plugin/routes.ts:119`、`portainer/routes.ts:103` 审计日志只记 who/which/what 不记参数。
- Navidrome 认证用 salt+md5 token，口令不进 URL（`connector/navidrome-library.ts:98-104`）。
- `outboundRequest` 已 `redirect: "manual"` 封重定向绕过；超时 AbortController 生效。
- 图标下发有双层防护：`icon/sanitize.ts` 上传期净化 + `icon/routes.ts:103` 下发 `Content-Security-Policy: default-src 'none'; …; sandbox` + nosniff。
- 类型安全：`@ts-ignore`/`@ts-expect-error` 0 处，any 类仅 2 处（见 LNT-2）。

## 6 · 存疑（不入台账）

- **pnpm 补丁跨版本行为**：`patchedDependencies` 只对 `gridstack@14.0.0` 生效，解析到其它版本时 pnpm 是「静默不打补丁」还是「安装报错」未实测（不允许装包验证）；DEP-2 的修法已按最坏情况（静默失效）给。
- **日志脱敏覆盖面**：`app.ts` redact 未列 `credentials` 创建/修改口令的 body 字段名与改密字段名（未逐一路由核对字段名）；若字段名不在 6 条 redact 路径内，Fastify 请求日志可能带口令。需下一轮对照 `credentials/routes.ts`、`auth/routes.ts` 的 zod 字段名补齐。
- **iframe widget 的 `sandbox` 可配置项**（`apps/web/src/iframe-widget.tsx:16,32`）：若配置允许同时含 `allow-scripts`+`allow-same-origin` 即逃逸不透明源；未查配置表单是否过滤该组合。
- **`feed/connector.ts:132` 透传 `err.message`**：是否可能带含密 URL 取决于 RSS 源 URL 形态，与 SEC-4 同族但未逐行确认。
- DNS rebinding（SEC-3）在单用户自托管的可利用性评估为主观判断，如按「SSRF 绕过即 P0」严格口径可上调。

## 7 · 未覆盖范围（时间盒截断，待补评）

- **⑥ 安全复审剩余**：`plugin/package.ts` zip 解包路径穿越（zip-slip）逐行核验、`plugin/install.ts`、`icon/sanitize.ts` 净化规则细节（script/on* 事件/foreignObject 覆盖度）、CORS 配置全貌、`custom.css` 与 `styles-bridge.ts` 的 CSS 注入面、`auth/session.ts` token 生成/过期细节、`mail/*` IMAP 凭证传递链。
- **② 类型安全**：zod 入站覆盖逐路由清单（哪些 body/query/params 无 schema）、`api/openapi.ts ↔ api/schemas.ts` 一致性（归 12 分区）。
- **lint 落地面**：未实测 `npx oxlint --rules` 实名与现有 ~20 条存量 warning 的精确清单（§3 规则名为按分类建议）。
- **⑪ 构建产物体积**：`apps/web/dist` 体积构成、chunk 划分、ECharts 引入前基线未测量（需跑 `pnpm build`，涉产物写出，未执行）。
- 传递依赖多版本重复（深度扫描）、`pnpm licenses` 供应链许可审查未做。

## 8 · 本区条目统计

| 级别 | 条数 | 条目 |
|---|---|---|
| P0 | 0 | —（SEC-1 按严格口径可上调 P0，见条目内注） |
| P1 | 5 | DEP-2、SEC-1、SEC-2、SEC-4、SEC-5 |
| P2 | 8 | DEP-1、DEP-3、SEC-3、SEC-6、SEC-7、LNT-1、LNT-2、LNT-3 |
| 合计 | 13 | DEP×3 / SEC×7 / LNT×3 |
