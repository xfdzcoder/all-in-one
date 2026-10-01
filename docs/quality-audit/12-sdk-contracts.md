# 12 · widget-sdk 契约包 + 全仓契约一致性

> 范围：`packages/widget-sdk/src`（manifest / plugin ABI / jsx-template / service-overview / config / data / lifecycle / action）+ 全仓契约一致性（③ OpenAPI ↔ `apps/web/src/api.ts` ↔ zod、Monorepo 边界、② 类型安全、重复代码）。
> 依据：[README.md](README.md) 的维度与 P0/P1/P2 标准。只读评估，未改任何产品代码。

## A · ③ OpenAPI ↔ 前端 `api.ts` ↔ zod 逐条对照表

先给结论：**"zod → OpenAPI 生成"（D11）目前只覆盖 auth + dashboards**（`apps/server/src/api/openapi.ts:32-88`），其余约 55 条路由全部不在 OpenAPI 里；`apps/web/src/api.ts` 是手写客户端，与 zod/路由逐条对比如下（✓=一致，△=有出入，✗=缺失/不一致）。

| # | 客户端方法（api.ts） | 服务端路由（zod schema） | OpenAPI | 结论 |
|---|---|---|---|---|
| 1 | `me/login/logout` (175-178) | `auth/routes.ts:53-93` | ✓ (openapi.ts:36-55) | △ 登录路由**未用** `loginBody` 校验（见 CON-2） |
| 2 | `listDashboards/createDashboard` (179-180) | `dashboard/routes.ts:23-55`（`dashboardCreateBody` 支持 icon/columns/cellHeight） | ✓ | △ 客户端 `createDashboard(title)` 只发 `title`，服务端支持的 3 个字段无入口（合并 CON-10） |
| 3 | `patchDashboard` (181-186) | `dashboard/routes.ts:57-82`（`dashboardPatchBody`） | ✓ | △ `columns` 客户端 `number` vs zod `12\|16\|20\|24\|28\|32` 字面量联合（CON-14） |
| 4 | `saveLayout` (187-188) | `dashboard/routes.ts:97-113`（`layoutUpdateBody`） | ✓ | ✓ |
| 5 | `deleteDashboard` (189) | `dashboard/routes.ts:84-94` | ✓ | ✓ |
| 6 | `listTodos` (190-197) | `todo/routes.ts:29-63`（query 手写解析，无 zod） | ✗ | ✓ 路径/参数一致（`list`/`tagIds` CSV/`includeArchived=1`） |
| 7 | `createTodo` (198-199) | `todo/routes.ts:65-82`（`createBody`） | ✗ | ✓ |
| 8 | `patchTodo` (202-203) | `todo/routes.ts:84-105`（`patchBody` 还支持 `list`/`sortOrder`） | ✗ | △ 客户端漏 `list`/`sortOrder`（CON-10） |
| 9 | `deleteTodo/deleteTodoGroup` (200-204) | `todo/routes.ts:108-131` | ✗ | ✓ |
| 10 | `widgetData` (205-206) | `data/routes.ts:79-129`（`queryBody`）→ `{data, fetchedAt, cached}` | ✗ | △ 客户端丢弃 `fetchedAt`/`cached`（CON-7） |
| 11 | `portainerRestart` (208-209) | `portainer/routes.ts:93-111`（`restartBody`） | ✗ | ✓ |
| 12 | `createCredential` (210-211) | `credentials/routes.ts:27-38`（`createBody`，kind 缺省 "generic"） | ✗ | △ 客户端缺省 kind 传 "http-header"、无 `GET /api/credentials`（CON-8/CON-10） |
| 13 | `listDataSources/createDataSource/updateDataSource/deleteDataSource` (213-221) | `data-source/routes.ts:63-154` | ✗ | ✓（PATCH 合并语义服务端自行处理） |
| 14 | —（无方法） | `GET /api/data-sources/kinds`（data-source/routes.ts:157-159） | ✗ | ✗ 孤儿端点（CON-8） |
| 15 | `listIcons/createIcon/deleteIcon` (223-225) | `icon/routes.ts:41-123` | ✗ | △ `GET /api/icons/:id` 无归属校验（CON-11） |
| 16 | `listFeeds/createFeed/deleteFeed/markFeedRead` (226-237) | `feed/routes.ts:19-84` | ✗ | ✓ |
| 17 | —（无方法） | `GET /api/feeds/read`（feed/routes.ts:62-65）、`POST /api/feeds/read-batch`（86-102） | ✗ | ✗ 孤儿端点（CON-8） |
| 18 | `listTags/createTag/updateTag/deleteTag/setTargetTags` (228-234) | `tag/routes.ts:86-187` | ✗ | △ `createTag` 返回类型含服务端不回的 `targetCount`（CON-5） |
| 19 | —（无方法） | `GET /api/tags/targets/:targetType/:targetId`（tag/routes.ts:159-164） | ✗ | ✗ 孤儿端点（CON-8） |
| 20 | `listPlugins/installPlugin/uninstallPlugin/setPluginStatus/pluginAction/getPluginEntry` (238-246) | `plugin/routes.ts:44-145` | ✗ | ✓（`actions` body `{name,params}`、entry `{manifest,code}` 一致） |
| 21 | —（无方法） | `GET /api/plugins/:id`（plugin/routes.ts:63-69） | ✗ | ✗ 孤儿端点（CON-8） |
| 22 | `listBoards/getBoardTree/createBoard/renameBoard/deleteBoard` (247-252) | `kanban/routes.ts:52-120` | ✗ | ✓ |
| 23 | `createColumn/renameColumn/deleteColumn` (253-257) | `kanban/routes.ts:123-176` | ✗ | ✓（`sortOrder` 服务端可选、客户端未暴露，功能不缺） |
| 24 | `createCard/patchCard/deleteCard` (258-262) | `kanban/routes.ts:179-257`（`cardCreateBody` 另支持可选 `body`） | ✗ | ✓ |
| 25 | `listMailAccounts/createMailAccount/patchMailAccount/deleteMailAccount` (263-285) | `mail/routes.ts:59-84,152-158` | ✗ | △ `patchMailAccount` 返回 `unknown`、漏 `credentialId`（CON-10） |
| 26 | `gmailAuthorize` (286-287) | `mail/routes.ts:88-102` | ✗ | ✓ |
| 27 | `mailMessages/mailMessage` (288-297) | `mail/routes.ts:161-193`（`listQuery` limit≤50、`bodyParams.uid: string`） | ✗ | ✗ `uid` 类型不一致（CON-3）；`limit` 无上限（CON-10） |
| 28 | —（无方法，SSE 直连） | `GET /api/events`（data/routes.ts:132-152） | ✗ | ✓（data-hooks.ts:102 直接 EventSource） |
| 29 | — | `GET /api/health`、`/api/openapi.json`、`/custom.css`（app.ts:61-80） | △ health ✓，openapi/custom.css 未记录 | P2 文档瑕疵（并入 CON-1） |

## B · 台账

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| SDK-1 | `packages/widget-sdk/src/manifest.ts:56`；`plugin.ts:57`；触发点 `apps/server/src/plugin/package.ts:99` | `validateManifest`/`validatePluginManifest` 入参为 `null` 时 `m.type` 直接 TypeError（`JSON.parse("null")` 合法 JSON）；服务端安装插件时 manifest.json 为 `null` → 未捕获异常 → 500 而非 400（`plugin/routes.ts:52-55` 只接插件自有 Error 类） | P1 | 校验器入口先 `if (!m \|\| typeof m !== "object") return ["manifest 必须是对象"]`；服务端 catch 兜底 400 |
| SDK-2 | `manifest.ts:54`；`plugin.ts:56` | 校验函数入参用具体类型 `WidgetManifest`/`PluginManifest`，调用方校验不可信 JSON 被迫断言：`package.ts:99` `validatePluginManifest(parsed as PluginManifest)`、`install.ts:131,165`、`plugin/data.ts:50` | P2 | 签名改 `(m: unknown): string[]`，内部收窄；调用方去掉 `as` |
| SDK-3 | `manifest.ts:54-68` | `validateManifest` 不校验 `configSchema`（接口必填字段）也不调用 `validateConfigSchema`；缺/坏 configSchema 的 manifest 可通过安装校验，宿主表单渲染无依据（与 README:121"安装/加载前用 validatePluginManifest() 校验"不符） | P2 | `validateManifest` 内追加 `configSchema` 必填 + `validateConfigSchema()` 结果并入错误列表 |
| SDK-4 | `service-overview.ts:99-102` | `validateServiceOverview` 对 `statuses`/`lists` 仅校验"是数组"，条目形状（`tone`/`text`/`title`/`items[]`）与 tone 枚举完全不查，与注释"用于适配器契约测试与插件数据边界"、README:93 不符 | P2 | 按 `ServiceStatus`/`ServiceList`/`ServiceListItem` 逐字段校验（含 tone 枚举） |
| SDK-5 | `packages/widget-sdk/README.md:46` vs `config.ts:7-18` | J8 扩展规范的字段类型清单 `text \| number \| boolean \| select \| json \| secret` 缺 `textarea`、`multiselect`（实现已有且 web 在用） | P2 | README 补全两种类型及 `multiselect` 值形态（string[]）说明 |
| SDK-6 | `plugin.ts:26` vs `README.md:145`、`apps/web/src/plugin-frame.tsx:21,63-64` | 插件入口 ABI 两说：plugin.ts 注释"导出 `WidgetComponent`"（`lifecycle.ts:26` `(props)=>unknown`），README 与实际加载器契约是**默认导出 `render(props, ctx)`**（加载器 `mod.default` 非函数即报错） | P2 | 统一为 `render(props, ctx)`；plugin.ts 注释与 `WidgetComponent` 的适用范围（内置组件）写清 |
| SDK-7 | `action.ts:4` vs `apps/server/src/plugin/routes.ts:102` | 注释称动作走 `POST /api/widgets/:id/actions/:name`，实际是 `POST /api/plugins/:id/actions` + body `{name, params}` | P2 | 修正注释为真实路由 |
| SDK-8 | `jsx-template.ts:21,457` | `TEMPLATE_MAX_BYTES` 用 `src.length`（UTF-16 code unit）比较，名不副实：64K 个 CJK 字符 ≈ 128KB 字节可通过（上限形同 2 倍） | P2 | 按 `new TextEncoder().encode(src).length` 计，或改名 `TEMPLATE_MAX_CHARS` |
| SDK-9 | `jsx-template.ts:160-161` | `Literal` 节点直接回传 acorn `n.value`，bigint/regexp 字面量会突破 `TemplateValue` 的 `string\|number\|boolean\|null` 声明（类型面漏，渲染侧 `String(v)` 兜底未炸） | P2 | Literal 只放行四种标量，其余报"不支持的字面量" |
| CON-1 | `apps/server/src/api/openapi.ts:19-88` | OpenAPI 只含 health/auth/dashboards 共 9 个操作；todos/tags/feeds/plugins/kanban/mail/credentials/data-sources/icons/widgets-data/events/portainer 等约 55 条路由未进文档 —— D11"zod→OpenAPI 生成"名不副实，③ 三方一致性失去基准（对照表 #6-#29"OpenAPI ✗"列） | P1 | 路由级 zod schema 集中后由脚本生成完整 paths（或按域分批补齐），并加"新增路由必须进 OpenAPI"的测试守卫 |
| CON-2 | `apps/server/src/api/schemas.ts:5-8`（`loginBody`）vs `auth/routes.ts:53-60`；`openapi.ts:40` | `POST /api/auth/login` 的 OpenAPI 声明用 `loginBody` 校验，但路由手写 truthy 检查、从不 `safeParse` —— `username≤128`/`password≤256` 限制形同虚设（超长口令照样进 argon2），OpenAPI 与实现漂移 | P1 | 登录路由改用 `loginBody.safeParse`；或删除 schema 并改 OpenAPI 描述（前者更佳） |
| CON-3 | `apps/web/src/api.ts:117,296-297` vs `apps/server/src/mail/client.ts:24`、`gmail.ts:147`、`mail/routes.ts:45-46` | 邮件 uid 类型三方不一致：客户端 `uid: number`（`MailListEntry.uid`、`mailMessage(uid: number)`），服务端 `number \| string`，Gmail 账号 uid 是字符串消息 id（`uid: meta.id`）—— Gmail 下前端类型说谎，任何数字用法（排序/比较/缓存键）静默出错 | P1 | `api.ts` 改 `uid: number \| string`（或 string），`mailMessage(uid: number \| string)`；对齐 `bodyParams.uid: z.string()` 的注释 |
| CON-4 | `packages/widget-sdk/package.json:7-19`（`main/exports/prepare`）；根 `package.json:6-14`；`apps/*/tsconfig*.json`（无 paths） | widget-sdk 发 `dist/` 消费的坑：`dist/` gitignore、只有 `prepare: tsc`（install 时跑一次），**无 dev/watch 脚本**；web/server 均按包名解析 `dist/index.js`+`dist/index.d.ts` —— 改 SDK 源码后 `pnpm dev`/`pnpm test`/`pnpm typecheck` 都不重建，应用层静默使用旧契约（类型与运行时同时漂移，SDK 单测却测新 src） | P1 | 加 `dev: tsc --watch` 并入根 `pnpm dev`；或门禁前置 `pnpm --filter @all-in-one/widget-sdk build`；至少在 widget-sdk README 写明"改 src 必须 rebuild" |
| CON-5 | `apps/web/src/api.ts:78-83,229` vs `apps/server/src/tag/routes.ts:113-121` | `createTag` 声明返回 `TagRow`（必含 `targetCount: number`），服务端 POST /api/tags 返回的行**无** `targetCount`（只有 GET /api/tags 补计数）—— 客户端类型比实现多一个必填字段 | P2 | `createTag` 返回类型改 `Omit<TagRow,"targetCount">` 或服务端补 `targetCount: 0` |
| CON-6 | `apps/web/src/api.ts:5` vs `apps/server/src/api/schemas.ts:28` | `DASHBOARD_COLUMNS` 双份维护（注释声明服务端权威），无同步守卫：任一侧改档位不会报错，前端下拉/断点与服务端校验可静默分叉 | P2 | 加契约测试断言两侧相等，或由服务端 `/api/health`/配置下发档位 |
| CON-7 | `apps/server/src/data/routes.ts:96,121`；`packages/widget-sdk/src/data.ts`（`WidgetDataResponse`）；`apps/web/src/api.ts:206` | 数据通道响应三方不齐：服务端回 `{data, fetchedAt, cached}`，SDK 契约只有 `{data, fetchedAt}`（`cached` 未入契约），web `widgetData` 丢弃两者、`WidgetDataState.fetchedAt` 只能用客户端时间戳兜（`data-hooks.ts:163,219`）—— "x 分钟前"语义失真，SDK 导出类型无消费方 | P2 | 契约补 `cached?: boolean`；`widgetData` 返回完整 `WidgetDataResponse` 并让 hooks 用服务端 `fetchedAt` |
| CON-8 | `feed/routes.ts:62-65,86-102`；`tag/routes.ts:159-164`；`data-source/routes.ts:157-159`；`credentials/routes.ts:23-25`；`plugin/routes.ts:63-69` | 6 个孤儿端点（客户端无方法、`apps/web/src`+`scripts` 零调用，grep 实证）：`GET /api/feeds/read`、`POST /api/feeds/read-batch`、`GET /api/tags/targets/:t/:id`、`GET /api/data-sources/kinds`、`GET /api/credentials`、`GET /api/plugins/:id` | P2 | 确认无产品用途后删除（或补客户端方法）；孤儿端点也是攻击面 |
| CON-9 | `apps/web/src/api.ts:160-163,166-172`；`data-hooks.ts:162` 等 | 错误语义不一致：服务端错误统一 `{"error":"..."}` JSON，客户端 `ApiError.message = res.text()` 原文，UI 直接展示 `e.message` → 用户看到 `{"error":"invalid body"}` 原始 JSON；且各路由文案不统一（`invalid body`/`invalid request`/`invalid query`/`invalid tag`/`invalid icon` 混用） | P2 | `req()` 解析 JSON 取 `error` 字段兜底原文；服务端统一错误形状 `{error, code}` 并归并文案 |
| CON-10 | `apps/web/src/api.ts:180-181,202,264-284,288-291` vs `todo/routes.ts:15-23`、`mail/routes.ts:31-41,48-53`、`dashboard/routes.ts` | 客户端能力面系统性窄于服务端（多传/漏传类）：`createDashboard` 不传 icon/columns/cellHeight；`patchTodo` 漏 `list`/`sortOrder`；mail 账号 PATCH 漏 `credentialId`、`patchMailAccount` 返回 `req<unknown>`；`mailMessages(limit)` 无上限（服务端 max 50，超即 400） | P2 | 按需补齐方法签名/返回类型；`limit` 用联合或注释约束 ≤50 |
| CON-11 | `apps/server/src/icon/routes.ts:82-91`（GET）vs `:118`（DELETE） | `GET /api/icons/:id` 只按 id 查行、不校验 `userId`，而 DELETE 显式校验 `row.userId !== req.user!.id` —— 归属校验不一致，多用户预留（NFR5/D9）下的越权读面（当前单用户不可利用，故不入 P0） | P1 | GET 补 `row.userId !== req.user!.id → 404`，与 DELETE 对齐 |
| CON-12 | `apps/server/src/plugin/package.ts:103-105` vs `packages/widget-sdk/src/plugin.ts:65` | `isSafePluginEntry(manifest.plugin.entry)` 二次校验与 `validatePluginManifest` 内部检查（plugin.ts:65）完全重复，属死代码 | P2 | 删 package.ts 二次检查（保留 `files.has(entry)` 存在性检查） |
| CON-13 | `apps/web/src/api.ts:205-206`；`data-hooks.ts:44,236,346,381,425,470,505,535,551,593,685,724` | 数据通道出参全靠 `as Promise<...>`/`(r as {...})` 断言（12+ 处），`widgetData` 为 `unknown` —— 契约层类型安全在此断链，形状错只能运行时发现（② 类型安全） | P2 | 按 widget type 建 `WidgetDataMap` 泛型映射（至少给 service-overview/rss 等高频型），或在 SDK 增加运行时 shape guard 供 hook 调用 |
| CON-14 | `apps/web/src/api.ts:5,13,181-185` vs `apps/server/src/api/schemas.ts:28-40` | `columns` 类型不一致：客户端 `number`，服务端 zod 为 12/16/20/24/28/32 字面量联合 —— 客户端可编译通过任意列数，运行时才 400（`Board.tsx:244` 已自行回落 12，说明确有此风险） | P2 | 客户端 `columns` 用 `typeof DASHBOARD_COLUMNS[number]`，patch 类型随之收紧 |

**受限 JSX 逃逸面（jsx-template.ts）专项结论**：编译为节点树+闭包（无 eval/Function）、标识符/方法/属性全白名单、computed key 运行时过滤 `DANGEROUS_KEYS`、`href` 只放行 https/相对/#、`parseExpressionAt` 后强制消费全部源码防尾随注入、`FORBIDDEN_SOURCE` 二道闸 —— **未发现逃逸路径**（eval/import/globalThis/fetch 不可达，`constructor/__proto__/call/apply/bind` 全拒）。残留仅为 SDK-8/SDK-9 两处边界瑕疵；`BinaryExpression`/`UnaryExpression` 求值闭包无 try/catch，但数据面来自 JSON（无 Symbol/函数），实际不可触发（存疑档）。

## C · Monorepo 边界（结论：合规）

- widget-sdk 依赖仅 `acorn`/`acorn-jsx`（package.json:26-29），`src` 无任何 `apps/*` 或 gridstack import（grep 实证，gridstack 字样只出现在注释与 README）——**无反向依赖、无 gridstack 泄漏**。
- 消费方式风险见 CON-4（dist 陈旧坑）。

## D · 存疑（不入台账）

1. `BinaryExpression`/`UnaryExpression` 闭包（jsx-template.ts:264-315）无 try/catch，理论上非 JSON 数据（Symbol 等）可使求值抛错；现数据全部来自服务端 JSON，无法构造 —— 待有宿主注入非 JSON 数据的路径再评。
2. `POST /api/feeds/read` 对已读 itemKey 重复调用仍 `onChanged()` 广播（feed/routes.ts:82）——多一次失效通知，无错误行为。
3. `plugin.ts:50` `isPluginManifest` 未检查 `plugin` 为对象（仅判非空）；当前调用链后接 `validatePluginManifest` 兜底，未见实际危害。

## E · 未覆盖范围（本轮时间盒未深挖）

- `packages/widget-sdk/src/*.test.ts` 四个测试文件的逐条断言质量与盲区（归 13-tests-verify.md 更合适，本轮只抽查）。
- `apps/web` 渲染层（jsx-template.tsx / plugin-frame.tsx / ConfigForm）除契约接缝外的实现质量（归 11-web.md）。
- connector 适配器输出与 `validateServiceOverview` 的实际调和（`apps/server/src/connector/service.ts`）只看了接缝。
- 重复代码维度只做了定向抽查（DASHBOARD_COLUMNS、isSecretRef/parseRestartAllow 归属），未做全量相似度扫描。

## F · 条目统计

| 级别 | 条数 | 明细 |
|---|---|---|
| P0 | 0 | — |
| P1 | 6 | SDK-1、CON-1、CON-2、CON-3、CON-4、CON-11 |
| P2 | 17 | SDK-2…SDK-9（8）、CON-5…CON-10、CON-12、CON-13、CON-14（9） |
