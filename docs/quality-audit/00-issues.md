# 质量体检台账（P0/P1/P2）

> 来源：[README.md](README.md) 6 份分域报告汇总（2026-10-02，Q95）。逐条明细与建议修法全文见各分域报告；本表是**修复批次工作单**。状态：✅ 汇总完成。

## 0 · 统计

| 报告 | P0 | P1 | P2 | 小计 |
|---|---|---|---|---|
| [10-server.md](10-server.md) | 2 | 10 | 17 | 29 |
| [11-web.md](11-web.md) | 0 | 10 | 20 | 30 |
| [12-sdk-contracts.md](12-sdk-contracts.md) | 0 | 6 | 17 | 23 |
| [13-tests-verify.md](13-tests-verify.md) | 1 | 8 | 14 | 23 |
| [14-deps-security-lint.md](14-deps-security-lint.md) | 0 | 5 | 8 | 13 |
| [15-docs.md](15-docs.md) | 0 | Q101b ✅ / DOC-13 ⏳ | 26 | 28 |
| **合计** | **3** | **41** | **102** | **146** |

另：已定项 QA-001（P1）/ QA-002（P2）；存疑约 8 条见各报告末节（不入台账）。

## P0 · 崩溃 / 安全 / 数据

> ✅ = 已修复（Q97a，2026-10-02）。SEC-1 与 SRV-01 同函数，随 Q97a 一并补严。

| ID | 位置 | 问题 | 批次 | 报告 |
|---|---|---|---|---|
| SRV-01 ✅ | apps/server/src/connector/ssrf.ts:25-35 | SSRF 基线可绕过（IPv4-mapped IPv6 十六进制形态）。isPrivateIp 的 IPv6 分支只在 lower.startsWith("::ffff:") 时取后缀按 IPv4 复检，且后缀必须是点分十进制。::ffff:7f00:1（十六进制组）取后缀得 7f00:1 → is | Q97 | 10 |
| SRV-02 ✅ | apps/server/src/app.ts:117-136 | 静态资源处理器路径穿越。path.join(publicDir, req.url.replace(/^\//, "")) 会把 ../ 段正常化出 publicDir 之外：curl --path-as-is http://host/../../etc/passwd（或绝对路径穿越）→ exists | Q97 | 10 |
| TST-19 ✅ | 破坏性覆写「首页」布局且不恢复（成功路径外零还原）：verify-live.mjs:120-135（脚本头注释明写「用真实生产实例」）、verify-svc.mjs:304-319、verify-m1.mjs:115-1 | 对真实/用户「首页」执行 PUT /layout 覆写成固定 seed、不做原布局快照与还原——真机上跑一次即永久销毁用户布局（数据丢失/错误持久化写入）。正面样板是 verify-gallery-live.mjs:56-58,337-343（临时草稿盘自建自删、清理在 finally），全仓仅 p | Q97 | 13 |

## P1 · 缺陷 / 静默失败 / 测试盲区

| ID | 位置 | 问题 | 批次 | 报告 |
|---|---|---|---|---|
| CON-1 ✅ | apps/server/src/api/openapi.ts:19-88 | OpenAPI 只含 health/auth/dashboards 共 9 个操作；todos/tags/feeds/plugins/kanban/mail/credentials/data-sources/icons/widgets-data/events/portainer 等约 55 条路由未 | Q100 | 12 |
| CON-2 ✅ | apps/server/src/api/schemas.ts:5-8（loginBody）vs auth/routes.ts:53-60；openapi.ts:40 | POST /api/auth/login 的 OpenAPI 声明用 loginBody 校验，但路由手写 truthy 检查、从不 safeParse —— username≤128/password≤256 限制形同虚设（超长口令照样进 argon2），OpenAPI 与实现漂移 | Q100 | 12 |
| CON-3 ✅ | apps/web/src/api.ts:117,296-297 vs apps/server/src/mail/client.ts:24、gmail.ts:147、mail/routes.ts:45-46 | 邮件 uid 类型三方不一致：客户端 uid: number（MailListEntry.uid、mailMessage(uid: number)），服务端 number / string，Gmail 账号 uid 是字符串消息 id（uid: meta.id）—— Gmail 下前端类型说谎，任何 | Q100 | 12 |
| CON-4 ✅ | packages/widget-sdk/package.json:7-19（main/exports/prepare）；根 package.json:6-14；apps/*/tsconfig*.json（无 paths） | widget-sdk 发 dist/ 消费的坑：dist/ gitignore、只有 prepare: tsc（install 时跑一次），无 dev/watch 脚本；web/server 均按包名解析 dist/index.js+dist/index.d.ts —— 改 SDK 源码后 pnpm | Q100 | 12 |
| DEP-2 ✅ | apps/web/package.json:33（"gridstack": "^14.0.0"）；pnpm-lock.yaml:164 | Q43 补丁按精确版本 gridstack@14.0.0 记账，但声明是 ^14.0.0 范围。一旦 gridstack 发布 14.0.1+，新环境解析到新版本时 patchedDependencies 不会应用到它 → 拖动竞态（卡片内容消失）静默回归，且 verify-gdrag.mjs 若未 | Q100 | 14 |
| DOC-1 ✅ | docs/feature-plan/02-decisions.md:493 | D55 补记声称"早已在迭代中落地"与事实不符：原文「本条与 D56/D57 的结论早已在迭代中落地（见 07 队列 Q75–Q78、批 E2）」，但 ECharts/WS 均未实现——全仓无 echarts 依赖与 useEcharts（grep -rn "echarts" apps/web/pa | Q100 | 15 |
| DOC-2 ✅ | docs/deploy.md:69（配合 docker-compose.yml:16-25） | deploy.md 环境变量与 compose 透传不一致：deploy.md:69「LOG_LEVEL=debug/info/warn/error 可调」、:17「需设 ALLOW_PRIVATE_OUTBOUND=1」均只说 export，但 compose environment: 块只透传  | Q100 | 15 |
| SRV-07 ✅ | apps/server/src/connector/service.ts:422-427、connector/gallery.ts:95-100,133-138、connector/navidrome-library.t | 静默 catch 吞掉 configJson 解析错误 → 错误分类误导（10 处同款）。try { JSON.parse(row.configJson) } catch { /* noop */ } 后 config = {}，最终对外报「连接缺少地址」——真实原因是库里配置损坏，用户按提示去补地 | Q100 | 10 |
| SRV-11 ✅ | apps/server/drizzle/0000_*.sql … 0014_*.sql（15 个迁移，meta/ 仅快照） | ⑫ 迁移不可回滚：drizzle-kit 生成的迁移均为 up-only，无 down/回滚脚本，也没有手工回滚说明；migrate()（db/client.ts:36-39）启动自动 apply，一旦某迁移写坏（如 0014 之后新增约束）只能手工改库。schema.ts 里大量 notNull( | Q100 | 10 |
| TST-1 ✅ | apps/web/src/（46 个源文件中仅 grid-rescale.test.ts、media-wall-layout.test.ts 两份测试） | 前端 43 个源文件零单测，其中含纯逻辑可测模块：api.ts、clipboard.ts、config-form-utils.ts、data-hooks.ts、random-id.ts、widget-registry.ts、widget-edit-context.ts。这些改动无任何回归守卫（易回归 | Q100 | 13 |
| TST-10 ✅ | verify-svc.mjs:313（title === "首页" ?? list[0]）vs verify-svc.mjs:1051,1102,1171（list.find(x => (x.layoutJson ??  | 同一脚本内两套「找目标盘」口径：重置落在「首页/首个」，而后续 setWidgetProps/crashSeed/todoSeed 写向「首个非空布局盘」。多盘真机上两者可能不是同一个盘 → PUT layoutJson 写错盘（错误持久化写入）；?? list[0] 回落也会静默选中非目标盘后断言 | Q100 | 13 |
| TST-11 ✅ | verify-live.mjs:215（写死 1,376/269/38）、:224（写死 23/25）、:322（写死容器名 homepage/minecraft-mc-1/Exited (143)） | 写死真机快照断言：曲库涨一张、容器增减/重启即假红。同脚本 immich 段（verify-live.mjs:187-208）已示范「对账真机 API」并自注「写死快照会随照片增长假红」，但 navidrome/portainer 两段未同步整改 | Q100 | 13 |
| TST-2 ✅ | apps/server/src/mail/imap.ts:1-104；对照 apps/server/src/mail/mail.test.ts:47-69（MailClientFactory mock 直接返回内存数组） | 真实 IMAP 协议客户端（104 行：连接/UID 拉取/正文解析）零测试——测试全部走 mock factory 绕过它。协议解析回归（UID 类型、folder 参数、超时断连）无守卫 | Q100 | 13 |
| TST-20 ✅ | verify-svc.mjs:1126-1133（还原 crash 卡）、:1186-1192（还原双 todo）位于主流程尾部；:1193-1195 的 catch 直接跳到收尾，无 finally | 清理只在成功路径执行：流程中途 throw（如 page.evaluate/waitForSelector 抛错）即跳过两处还原，crash-rss 畸形卡与重复 todo 永久留在用户盘上，污染下一轮断言（脚本自己在 verify-svc.mjs:303 都承认「残留会污染断言」） | Q100 | 13 |
| TST-21 ✅ | 创建不清理（grep 证实：全仓 method: "DELETE" 仅出现在 mail accounts（verify-gmail.mjs:93,181、verify-mail.mjs:134）与 plugins（ver | 每轮运行向库内累积数据源/凭证：真机库越跑越脏，且 verify-live 的真实 API key/口令凭证（引用）永久留在凭证库（SEC3 场景下这些是高价值残留） | Q100 | 13 |
| TST-5 ✅ | apps/server/src/connector/service.ts:449-503（best() 12 个降级分支）vs apps/server/src/connector/service.test.ts | 契约测试未覆盖每条降级分支：仅 /connections 失败（service.test.ts:149）与 /memory 静默丢弃（:132,:144）有断言；immich 版本/统计双路由回落（service.ts:450-454）、navidrome 扫描状态/曲库统计/最近添加失败（:470 | Q100 | 13 |
| TST-6 ✅ | apps/server/src/connector/opencode.test.ts:107,124、apps/server/src/connector/monitor.test.ts:129 | 弱断言 expect(data.probe.error).toBeTruthy()——只断存在不断内容。D47「原因 + 怎么修」文案被换成 "error" 也全绿，降级文案回归无守卫（对照 service.test.ts:157-160 已示范强断言） | Q100 | 13 |
| CON-11 ✅ | apps/server/src/icon/routes.ts:82-91（GET）vs :118（DELETE） | GET /api/icons/:id 只按 id 查行、不校验 userId，而 DELETE 显式校验 row.userId !== req.user!.id —— 归属校验不一致，多用户预留（NFR5/D9）下的越权读面（当前单用户不可利用，故不入 P0） | Q98 | 12 |
| SEC-1 ✅ | apps/server/src/connector/ssrf.ts:28-42（isPrivateIp） | 内网段判定漏项 → SSRF 基线「默认拒内网」有绕过空档：① IPv6 link-local 只判 startsWith("fe80")，而 fe80::/10 实含 fe80–febf（fe81::1/fe90::1/febf::1 均通过）；② IPv6 组播 ff00::/8、站点本地 fe | Q98 | 14 |
| SEC-2 ✅ | apps/server/src/connector/registry.ts:96-103（outboundRequest） | maxBytes 上限在 await res.arrayBuffer() 全量缓冲之后才校验（bytes.byteLength > maxBytes 才抛）——超大响应仍被完整读入内存再丢弃，体积上限对内存打爆/DoS 形同虚设；随后还全量 TextDecoder().decode | Q98 | 14 |
| SEC-4 ✅ | apps/server/src/connector/ssrf.ts:35（SSRF blocked for ${target}）→ apps/server/src/data/routes.ts:126、apps/serv | 错误文案内嵌完整 target URL，经 502/400 响应体与日志外发。若 custom-api 配置的 URL 带 ?apikey=… 查询密钥或 user:pass@ 基本认证（常见 API 形态），密钥即进入日志/响应——与 NFR6 脱敏及 navidrome-library.ts:9 | Q98 | 14 |
| SEC-5 ✅ | apps/server/src/connector/registry.ts:66-73（cacheKeyOf）；消费点 apps/server/src/data/routes.ts:77 | JSON.stringify(query.config, Object.keys(query.config).sort()) 传的是 replacer 数组，只序列化顶层键 → 嵌套的 SecretRef {credentialRef}（packages/widget-sdk/src/config. | Q98 | 14 |
| SRV-03 ✅ | apps/server/src/connector/registry.ts:75-81 | cacheKeyOf 对嵌套对象键丢失 → 缓存键碰撞。JSON.stringify(query.config, Object.keys(query.config).sort()) 的 replacer 数组只含顶层键，嵌套对象（SecretRef {type,credentialRef}、app- | Q98 | 10 |
| SRV-04 ✅ | apps/server/src/connector/registry.ts:107-111 | maxBytes 形同虚设：先整包缓冲再判大小。const bytes = new Uint8Array(await res.arrayBuffer()) 在检查 bytes.byteLength > maxBytes 之前就把响应完整读进内存——恶意/异常上游回一个 2GB 响应会先把进程内存打爆 | Q98 | 10 |
| SRV-06 ✅ | apps/server/src/data/routes.ts:94-120 + apps/server/src/data/cache.ts:49-52 | 无 single-flight：并发同 key 取数会重复打上游。allowFetch() 的 lastFetch 只在 set() 时写入，两个并发请求同时 miss 缓存会都通过限流判定、各自回源（gallery 单请求就可能连打 6+120 次上游）。与 NFR4「防打爆第三方 API」目标相 | Q98 | 10 |
| SRV-08 ✅ | apps/server/src/connector/service.ts:80（genericHint ?? "该项暂缺"）、connector/mihomo-nodes.ts:124 | 降级文案违反 D47「原因 + 怎么修」：degradeNote 兜底 hint「该项暂缺」与 mihomo 订阅源失败的「—— 该项暂缺」只给结论不给修法，接近 08 §5 明令禁止的「该服务未提供 X」式甩锅（Navidrome 族无 permissionHint，全部走这个兜底）。对照同文件  | Q98 | 10 |
| SRV-09 ✅ | apps/server/src/icon/routes.ts:85-91 | GET /api/icons/:id 缺归属校验（越权读）：只按 customIcon.id 查询即回文件，未比对 row.userId !== req.user!.id（同文件 DELETE 在 :118 有比对）。当前单用户无实际越权，但违背 NFR5/D9「schema 带归属字段为多用户预留 | Q98 | 10 |
| SRV-10 ✅ | apps/server/src/todo/connector.ts:15-22 | todo connector 不排除归档项，与 REST/文档语义不一致。REST GET /api/todos 默认 eq(todo.archived,false)（todo/routes.ts:39），schema 注释明言「归档项不在组件显示，仅数据源管理可见/可恢复」（db/schema.t | Q98 | 10 |
| WEB-2 ✅ | apps/web/src/data-admin.tsx:184-188 + apps/server/src/data-source/routes.ts:121-128 | 编辑数据连接时 clean 把空串/undefined 字段整体剔除，而服务端 PATCH 是「合并保留旧值」→ 任何文本字段都无法清空。最危险是 Portainer restartAllow：用户清空「重启白名单」想禁重启，保存后旧白名单仍在（D51「留空=禁止重启」失效），UI 看起来已清空 | Q98 | 11 |
| WEB-5 ✅ | data-hooks.ts:724 vs :734 | useFeeds：queryFn 发送清洗后的 tags，refresh（force）却发送原始 tagIds（Q93 注释明言可能是 ""/非数组畸形值）→ 畸形配置下「查询正常、点刷新报错」的不一致行为 | Q98 | 11 |
| SDK-1 ✅ | packages/widget-sdk/src/manifest.ts:56；plugin.ts:57；触发点 apps/server/src/plugin/package.ts:99 | validateManifest/validatePluginManifest 入参为 null 时 m.type 直接 TypeError（JSON.parse("null") 合法 JSON）；服务端安装插件时 manifest.json 为 null → 未捕获异常 → 500 而非 400（ | Q99 | 12 |
| SRV-05 ✅ | apps/server/src/data/cache.ts:31-35,54-68 + apps/server/src/connector/gallery.ts:197-238、connector/navidrome-l | 缓存按条目数封顶、不按字节封顶 → base64 缩略图常驻内存可达 GB 级。gallery/navidrome-library 的返回值是内联 base64 data URI（单缩略图上限 500KB/1MB，最多 120 项 → 单条数据 80MB 级，实测典型 ~5MB），DataCache | Q99 | 10 |
| SRV-29 ✅ | apps/server/src/connector/gallery.ts:202-224、connector/navidrome-library.ts:220-249 | 缩略图/封面串行抓取，无并发上限也无总超时：for ... await 逐张抓，gallery 最多 120 张 × TIMEOUT_MS=8000，navidrome 最多 120 张 × 2 次（主取+回落）——上游普遍超时时单个 /api/widgets/data 请求最坏可挂 16～32 分 | Q99 | 10 |
| WEB-1 ✅ | apps/web/src/mail-widget.tsx:31,67 | 邮箱多选过滤是客户端的：useMailMessages(undefined, limit) 先按全局取 20 封，再用 allowIds 过滤。选中 1 个账号时，20 封里可能只有几封属于它 → 列表近乎空白，用户以为「没邮件」（功能缺陷，limit 语义被过滤破坏） | Q99 | 11 |
| WEB-10 ✅ | immich-gallery-widget.tsx:55-56；navidrome-library-widget.tsx:46-47 | 为解析一个相册/艺人名挂 useDynamicOptionsMap() —— 该 hook 内部触发 12+ 个查询（tags/todos/boards/mail/4 类连接/媒体选项，data-hooks.ts:845-872），每张画廊卡都订阅全部查询、任一失效即整卡重渲染（过度取数 + 无谓重 | Q99 | 11 |
| WEB-3 ✅ | apps/web/src/portainer-containers-widget.tsx:68-102 + confirm.tsx:36 | 容器行是 <button>，内部又嵌 ConfirmAction 的 ActionIcon <button> —— 非法嵌套交互元素（React DOM 嵌套告警 / AT 行为未定义），且点击「重启」事件冒泡到行 onClick → 确认框与日志 Modal 同时弹出 | Q99 | 11 |
| WEB-4 ✅ | data-hooks.ts:222-224,251-253,357-359,392-394,624,734；kanban-widget.tsx:75；data-admin.tsx:505,522,533；mail-acc | 大量 void promise.then(...) 无 .catch()（手动刷新 force 回源、kanban 批量 patchCard、创建看板、删除账号、退出登录）→ 失败产生 unhandled rejection、UI 无任何反馈（对照 forceRefetch（data-hooks.t | Q99 | 11 |
| WEB-6 ✅ | todo-widget.tsx:67,77,91,109,137；kanban-widget.tsx:57,306,320,421,431,444；rss-widget.tsx:78；tag-filter.tsx:54； | useMutation(...).mutate(...) 全部未接 onError/未读 mutation.error（只有 addSource/createTag 两处有）→ 勾选、增删卡、打标签等失败静默，界面看似成功 | Q99 | 11 |
| WEB-7 ✅ | error-boundary.tsx + widget-chrome.tsx:63 | ErrorBoundary 只覆盖 gridstack 卡片内部（Q93）；App/Board 工具栏/配置 Modal（ConfigForm）/DataAdmin/PluginAdmin/LoginPage 均无边界 —— 任一处 render 抛错仍整页白屏且不可恢复（如 RelativeTim | Q99 | 11 |
| WEB-8 ✅ | data-hooks.ts:14,66-73,425,470 | ⑤ 缩略图 base64 常驻 + churn：immich/navidrome 的 data URI 存进 react-query 缓存（queryClient 未配 gcTime，默认 5 分钟；挂载期无限驻留），且 SSE 兜底轮询 invalidateAllData 每 30s 失效 ["i | Q99 | 11 |
| WEB-9 ✅ | ui.tsx:131-133 | RelativeTime 对 value 无防护：new Date(value).toISOString() 在非法时间（空串/脏数据）render 期抛 RangeError → 整卡崩溃（formatRelative 有防护，RelativeTime 却先算 abs） | Q99 | 11 |

## P2 · 可维护性 / 重复 / 文案 / 文档（逐条见分域报告，按批清）

| 报告 | P2 条目 ID | 批次 |
|---|---|---|
| [10-server.md](10-server.md) | SRV-12, SRV-13, SRV-14, SRV-15, SRV-16, SRV-17, SRV-18, SRV-19, SRV-20, SRV-21, SRV-22, SRV-23, SRV-24, SRV-25, SRV-26, SRV-27, SRV-28 | Q101 |
| [11-web.md](11-web.md) | WEB-11, WEB-12, WEB-13, WEB-14, WEB-15, WEB-16, WEB-17, WEB-18, WEB-19, WEB-20, WEB-21, WEB-22, WEB-23, WEB-24, WEB-25, WEB-26, WEB-27, WEB-28, WEB-29, WEB-30 | Q101 |
| [12-sdk-contracts.md](12-sdk-contracts.md) | SDK-2, SDK-3, SDK-4, SDK-5, SDK-6, SDK-7, SDK-8, SDK-9, CON-5, CON-6, CON-7, CON-8, CON-9, CON-10, CON-12, CON-13, CON-14 | Q101 |
| [13-tests-verify.md](13-tests-verify.md) | TST-3, TST-4, TST-7, TST-8, TST-9, TST-12, TST-13, TST-14, TST-15, TST-16, TST-17, TST-18, TST-22, TST-23 | Q101 |
| [14-deps-security-lint.md](14-deps-security-lint.md) | DEP-1, DEP-3, SEC-3, SEC-6, SEC-7, LNT-1, LNT-2, LNT-3 | Q101 |
| [15-docs.md](15-docs.md) | DOC-3 ✅, DOC-4 ✅, DOC-5 ✅, DOC-6 ✅, DOC-17 ✅, DOC-18 ✅, DOC-19 ✅, DOC-21 ✅, DOC-22 ✅, DOC-23 ✅, DOC-24 ✅, DOC-25 ✅, DOC-26 ✅, DOC-27 ✅, DOC-28 ✅；余 DOC-7, DOC-8, DOC-9, DOC-10, DOC-11, DOC-12, DOC-13, DOC-14, DOC-15, DOC-16, DOC-20 → Q101b-2 | Q101b-1 ✅ / Q101b-2 ⏳ |
| QA-002 | minCell→rowHeight 一次性配置迁移 | Q101 |
| A11Y-1 | `jsx-a11y` 15 条（`prefer-tag-over-role`×9 / `click-events-have-key-events`×2 / `no-noninteractive-element-interactions`×2 / `no-autofocus`×2） | P2 | Q101（a11y 专项：复杂行 `div role=button` 与「真 button」的取舍需专门设计，WEB-3 教训在前） | ⏳ |
| LNT-1 | 三份 .oxlintrc.json 两份空规则集（静态检测面远窄于拍板目标） | **✅ 已修（Q96a）**：规则开足 + 定向豁免 + 清零 160 条（242→82） | Q96a ✅ |
| LNT-2 | 全仓仅存 2 处类型断言逃逸（抹 props 类型 / 双重断言绕 zod） | **✅ 已修（Q96b）**：单点收窄函数 + `isServiceOverview` 类型守卫（调用点零断言） | ✅ |
| LNT-3 | 死代码/未用导出/未用依赖无守卫 | **✅ 全清（Q96b/Q96c）**：knip 引入 + 死文件 1 + 死代码/未用导出 58 条清理 → **knip 零发现** | ✅ |

## 已定项（06 §3 #7 ⑭⑮）

| ID | 位置 | 问题 | 级别 | 批次 | 状态 |
|---|---|---|---|---|---|
| QA-001 ✅ | `apps/server/src/connector/gallery.ts` / `navidrome-library.ts`（data URI 组装） | ⑭ data URI mime 硬编码 `image/jpeg`，Navidrome PNG/WebP 封面被误标（现靠浏览器嗅探侥幸显示） | P1 | Q98 | ⏳ |
| QA-002 | `apps/web/src/widget-registry.ts`（`minCell` 键） | ⑮ 键名与语义不符 → 迁 `rowHeight` | P2 | **✅ 已修（Q101a）**：键改名 + 组件双读 + 服务端读写双向规范化（懒收敛）+ `LAYOUT_SCHEMA_VERSION` 升 2 | ✅ |

## 备查（历轮挂起项，已并入上表所属批次）

| 来源 | 问题 | 并入 |
|---|---|---|
| 07 记录 129 | verify 种子步「硬找首页」残留约 13 处 | TST-10（Q100） |
| 07 记录 129 | mail 账号删除是否回收孤儿 credential | **✅ 已修（Q98b）**：`deleteCredentialIfOrphan` 保守回收（mail 账号/连接 config/布局 SecretRef 三面引用扫描，拿不准就保留） |
| 07 记录 132 | verify-live 登录凭证两套来源（须手工 export） | TST-21 同批（Q100） |
| 07 记录 132 | verify-live navidrome/portainer 写死快照 | TST-11（Q100） |

## 待用户拍板（产品口径，已同步 07）

| 条目 | 取舍点 | 来源 |
|---|---|---|
| DOC-P1 | D10「手机/平板禁布局编辑」与实现 `min-width:768px` 不一致：768–1023px 平板竖屏**当前可以**编辑布局 —— 文档口径改实现、还是实现改回全禁？ | 15-docs.md 存疑节 |
