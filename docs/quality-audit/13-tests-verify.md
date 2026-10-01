# 13 · 测试与 verify 脚本体检（⑨ 测试矩阵与盲区、⑨ 脚本可维护性、⑬ 脚本污染数据）

> 范围：全部 vitest 测试（widget-sdk / web / server）+ `apps/web/scripts/*.mjs`（40 个 verify/capture 脚本，9114 行）+ `apps/web/e2e/`（Playwright）。
> 依据：[`README.md`](README.md) 的维度、分级与格式。只读评估，未跑 `pnpm test` / verify 脚本（按约束），全部结论基于静态审查与 grep 实证。
> 证据命令（可复现）：`grep -rn 'title === "首页"' apps/web/scripts apps/web/e2e`、`grep -rn 'method: "DELETE"' apps/web/scripts`、`wc -l apps/web/scripts/*.mjs`。

## ① 测试矩阵与盲区

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| TST-1 | `apps/web/src/`（46 个源文件中仅 `grid-rescale.test.ts`、`media-wall-layout.test.ts` 两份测试） | 前端 43 个源文件零单测，其中含**纯逻辑可测模块**：`api.ts`、`clipboard.ts`、`config-form-utils.ts`、`data-hooks.ts`、`random-id.ts`、`widget-registry.ts`、`widget-edit-context.ts`。这些改动无任何回归守卫（易回归盲区），`api.ts` ↔ OpenAPI 契约漂移也只能靠人肉发现 | P1 | 先给纯逻辑模块补 vitest（api 契约往返、clipboard 降级路径、config-form-utils 校验/序列化）；React 组件至少补关键行为用例（M3 Playwright 承接交互） |
| TST-2 | `apps/server/src/mail/imap.ts:1-104`；对照 `apps/server/src/mail/mail.test.ts:47-69`（`MailClientFactory` mock 直接返回内存数组） | 真实 IMAP 协议客户端（104 行：连接/UID 拉取/正文解析）**零测试**——测试全部走 mock factory 绕过它。协议解析回归（UID 类型、folder 参数、超时断连）无守卫 | P1 | 用内存 TCP/IMAP stub（或 node-imap 兼容 fixture）覆盖 `imap.ts` 的 list/body/错误三类路径；至少给解析函数抽出纯函数补单测 |
| TST-3 | `apps/server/src/connector/http.ts`（45 行）、`dashboard/seed.ts`、`mail/client.ts`、`mail/service.ts`、`auth/password.ts`、`auth/session.ts`、`auth/guard.ts`、`plugin/install.ts` | 仅被间接经过、无针对性用例。其中 `connector/http.ts` 是全部 connector 的出站封装（MAX_BYTES/超时），`plugin/install.ts`（169 行）含解包/入口路径校验（仅 `plugin/routes.test.ts:158` 断言一句 "unsafe entry path"） | P2 | 为 `connector/http.ts` 补超时/截断/非 JSON 三类用例；`plugin/install.ts` 补解包边界（zip slip、超大包、版本不符）；auth 三件套补直接单测 |
| TST-4 | `packages/widget-sdk/src/`：`config.ts`、`manifest.ts`、`data.ts`、`lifecycle.ts`、`action.ts`、`index.ts` | 仅 `contract/jsx-template/plugin/service-overview` 四份测试；`manifest.ts`/`config.ts` 的校验规则大部分只被 `contract.test.ts` 间接覆盖，`data.ts`/`lifecycle.ts`/`action.ts` 零断言 | P2 | 补 config/manifest 校验分支单测（与 `contract.test.ts` 合并归类即可） |
| TST-5 | `apps/server/src/connector/service.ts:449-503`（`best()` 12 个降级分支）vs `apps/server/src/connector/service.test.ts` | 契约测试**未覆盖每条降级分支**：仅 `/connections` 失败（`service.test.ts:149`）与 `/memory` 静默丢弃（`:132,:144`）有断言；immich 版本/统计**双路由回落**（`service.ts:450-454`）、navidrome 扫描状态/曲库统计/最近添加失败（`:470-472`）、portainer 容器列表/宿主信息失败（`:487-490`）、mihomo 规则/订阅源失败（`:501-502`）均无「指标缺席 + note 带原因与怎么修」断言 | P1 | 按 `best()` 逐分支补表驱动用例：每个分支断言 ①对应 metric/list 不渲染 ②note 含原因与怎么修 ③整卡不空白 ④输出过 `validateServiceOverview` |
| TST-6 | `apps/server/src/connector/opencode.test.ts:107,124`、`apps/server/src/connector/monitor.test.ts:129` | 弱断言 `expect(data.probe.error).toBeTruthy()`——只断存在不断内容。D47「原因 + 怎么修」文案被换成 `"error"` 也全绿，降级文案回归无守卫（对照 `service.test.ts:157-160` 已示范强断言） | P1 | 三处改为 `toContain(原因关键词)` + `toContain(怎么修关键词)` + `not.toContain("该服务未提供")` |
| TST-7 | `apps/server/src/data/routes.test.ts:12`（真 sleep 1100ms）、`apps/server/src/feed/routes.test.ts:264`（真 sleep 5100ms） | 真实 `setTimeout` 魔法数直接耦合 TTL(1s)/限流(5s) 实现值——实现调参即假红/假绿，且拖慢套件 ~7s | P2 | 用 `vi.useFakeTimers()` 或把 TTL/限流窗口注入后取小值；至少把 1100/5100 提为具名常量并注释来源 |
| TST-8 | `apps/server/src/data-source/routes.test.ts:134`（`name: \`q31-${Date.now()}\``） | 测试数据用时间戳命名，重复运行留残留行、并发同 ms 可能重名 | P2 | 用 `randomBytes(4).toString("hex")`（仓库其它测试已是此模式）并在 afterAll 清理 |

## ② verify 脚本可维护性 / 脆弱模式

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| TST-9 | 无回落的「硬找首页」**剩余 13 处**：`verify-drag.mjs:46`、`verify-m1.mjs:116`、`verify-i4.mjs:154`、`verify-tag.mjs:109`、`verify-jsx.mjs:126`、`verify-gmail.mjs:103`、`verify-d31.mjs:73`、`verify-gdrag.mjs:92,174`、`verify-mon.mjs:181`、`capture-design.mjs:214`、`capture-interaction.mjs:138`、`apps/web/e2e/journeys.spec.ts:30`（后者紧接 `home!.id` 非空断言，`journeys.spec.ts:31`） | `list.find(d => d.title === "首页")` 按标题硬匹配：真机/历史库无「首页」即 `home` 为 undefined，后续 `home.id` TypeError、整个脚本假红（e2e 直接 crash）。Q92 只修了 5 处 + verify-live 1 处 | P2 | 统一抽 `pickDashboard()`（优先 id 环境变量 > 标题精确 > 首个），13 处全部换用；e2e 去掉 `!` 非空断言改为显式 expect |
| TST-10 | `verify-svc.mjs:313`（`title === "首页" ?? list[0]`）vs `verify-svc.mjs:1051,1102,1171`（`list.find(x => (x.layoutJson ?? "[]") !== "[]") ?? list[0]`）；同类 `?? list[0]` 回落 10 处（`verify-p8.mjs:94`、`verify-mail.mjs:126`、`verify-kan.mjs:187`、`verify-gray.mjs:140`、`verify-live.mjs:129`、`verify-fr3.mjs:120`、`verify-opc.mjs:168`、`verify-svc.mjs:313,923,961`） | 同一脚本内两套「找目标盘」口径：重置落在「首页/首个」，而后续 `setWidgetProps`/`crashSeed`/`todoSeed` 写向「首个非空布局盘」。多盘真机上两者可能不是同一个盘 → **PUT layoutJson 写错盘**（错误持久化写入）；`?? list[0]` 回落也会静默选中非目标盘后断言全错 | P1 | 单一 `pickDashboard()` 返回值贯穿全脚本；写盘前断言 `d.id === 期望id`；回落时打印「选中的是 X」避免静默 |
| TST-11 | `verify-live.mjs:215`（写死 `1,376`/`269`/`38`）、`:224`（写死 `23/25`）、`:322`（写死容器名 `homepage`/`minecraft-mc-1`/`Exited (143)`） | 写死真机快照断言：曲库涨一张、容器增减/重启即**假红**。同脚本 immich 段（`verify-live.mjs:187-208`）已示范「对账真机 API」并自注「写死快照会随照片增长假红」，但 navidrome/portainer 两段未同步整改 | P1 | 与 immich 同款对账式断言：navidrome 对 `/rest/getArtists`/`getAlbumList2` 真值、portainer 对 `/api/endpoints/.../containers/json` 真值；容器名改为「真机清单的任一名字出现在卡上」 |
| TST-12 | `verify-svc.mjs:226-236`（`clickBtn`：`btns.find(b => b.textContent.trim().includes(l))`），同款复制 29 份（grep -l `const clickBtn` = 29 个文件） | 文本模糊匹配取**首个命中**：`"添加"` 会命中「添加组件」、同名按钮多处时点错第一个（首个匹配陷阱）；文案一改全线假红 | P2 | 抽 `scripts/lib/dom.mjs`，优先 `getByRole`/`data-testid` 语义定位（组件侧加 `data-testid`），文本匹配仅兜底且用 exact + 可见性过滤 |
| TST-13 | `verify-svc.mjs:259-281,350,369,…`（全脚本 57 处 `sleep()`）；典型同帧读：`verify-svc.mjs:704-709`（点 next 后**同一 evaluate** 内断言 `.wb-lightbox__img` 仍在）、`verify-svc.mjs:244-250`（`selectOption` 固定 `sleep(300)` 后读选项） | 靠固定 sleep 同步异步渲染（200–3000ms 魔法数），慢机假红/快机假绿；同帧读异步渲染结果是确定性竞态 | P2 | 统一 `waitFor(fn, pred, timeout)` 轮询助手替换 sleep；断言读 DOM 前先等目标条件成立 |
| TST-14 | 样板重复实测：登录块 39 份（grep -l `autocomplete=username`）、`ok()`+汇总+exit 40 份、`sleep` 定义 37 份、`clickBtn` 29 份、`selectOption` 9 份、浏览器 launch 配置 40 份、首页 seed 布局块 ~20 份（见 TST-19 清单）；`verify-svc.mjs:1-1201`（1201 行单文件、93 条断言、一个大 try/catch） | 无公共库：一次登录/选择器改动要改 39 个文件；`verify-svc.mjs` 单流程 1201 行，断言间隐式顺序耦合，任何一步 throw 后面全跳过 | P2 | 抽 `apps/web/scripts/lib/`（`report.mjs`（ok/汇总）、`session.mjs`（launch/login）、`dom.mjs`（clickBtn/selectOption/waitFor）、`seed.mjs`（pickDashboard/seedLayout）、`mock.mjs`（miniJpeg/起 mock 服务））；`verify-svc.mjs` 按 Q# 拆成多段子流程 |
| TST-15 | 假绿模式：历史 bug「helper 返回诊断字符串（truthy）被 `ok()` 当通过」已在 `verify-svc.mjs:254-258` 注释并防住（`addOverview` 强制返回布尔）；但「动作成功当结果断言」仍在：`verify-svc.mjs:463-471`（ok 断的是「找到了按钮并点了」）、`:483-491`、`:615-626`、`:704-710` 等（`ok(name, await page.evaluate(...return Boolean(btn)))`） | 点击类 `ok()` 只证「元素存在且 click() 被调」，不证效果；helper 返回值类型无统一约束，其它脚本若写 `return "失败原因"` 会复现静默假绿 | P2 | 点击类断言改为「点击后效果」（等结果 DOM）；lib 层 `ok()` 内加 `typeof pass === "boolean"` 守卫（非布尔即 FAIL 并报警） |
| TST-16 | `apps/web/scripts/tmp-quick.mjs:11`（调用未定义的 `sleep(1000)` → 跑即 ReferenceError）、`tmp-st.mjs:1-18` | 遗留调试脚本留在 scripts/：`tmp-quick.mjs` 是**跑不起来的死文件**；`tmp-st.mjs` 与 verify 职责重叠且写死登录口令 | P2 | 删除两个 `tmp-*`（或移入 `scripts/attic/` 并注明用途） |
| TST-17 | 39 个脚本 + `apps/web/e2e/journeys.spec.ts:10` 的 `process.env.ADMIN_PASSWORD ?? "<测试默认口令>"` 回退；`tmp-st.mjs:9` 明文写死同一默认口令 | 测试默认口令散落 40 处明文（非真实凭证，但与 D17「首启必须设 ADMIN_PASSWORD」的口径不一致，且改默认值要改 40 个文件） | P2 | 收敛到 `lib/session.mjs` 一处读取，缺失时直接报错退出（对齐 D17），不再内联默认值 |
| TST-18 | `apps/web/package.json:6-13`（无 e2e/verify script）；`apps/web/playwright.config.ts:5` 注释指向 `scripts/README`（不存在） | 40 个 verify 脚本 + Playwright 均未接入任何 `pnpm` script/门禁，靠 AGENTS.md 人肉记忆挑选执行；过时注释误导入口 | P2 | `package.json` 加 `test:e2e`、`verify:all`（分组串行）；修 `playwright.config.ts` 注释指向真实文档 |

## ⑬ verify 脚本污染真机/用户数据

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| TST-19 | **破坏性覆写「首页」布局且不恢复（成功路径外零还原）**：`verify-live.mjs:120-135`（脚本头注释明写「用**真实生产实例**」）、`verify-svc.mjs:304-319`、`verify-m1.mjs:115-121`、`verify-mail.mjs:125-131`、`verify-kan.mjs:186-192`、`verify-i4.mjs:153-159`、`verify-mon.mjs:180-186`、`verify-opc.mjs:167-173`、`verify-p8.mjs:93-99`、`verify-fr3.mjs:119-125`、`verify-tag.mjs:108`、`verify-d31.mjs:72-78`、`verify-drag.mjs:45-51`、`verify-gdrag.mjs:91-97,173-179`、`verify-gmail.mjs:102-108`、`verify-gray.mjs:139-145`、`verify-jsx.mjs:125-131`、`capture-design.mjs:213-219`、`capture-interaction.mjs:137-143`、`apps/web/e2e/journeys.spec.ts:18-33`（`resetHomeLayout`） | 对真实/用户「首页」执行 `PUT /layout` 覆写成固定 seed、**不做原布局快照与还原**——真机上跑一次即永久销毁用户布局（数据丢失/错误持久化写入）。正面样板是 `verify-gallery-live.mjs:56-58,337-343`（临时草稿盘**自建自删**、清理在 `finally`），全仓仅 `probe-container-badge.mjs:39,117` 同款 | **P0** | 统一改「临时草稿盘自建自删」：所有 verify/capture 只在自建 dashboard 上播种；确需动首页的（e2e J2 旅程）先 GET 备份 layoutJson、`finally` 里还原并把备份失败报红；`resetHomeLayout` 同改 |
| TST-20 | `verify-svc.mjs:1126-1133`（还原 crash 卡）、`:1186-1192`（还原双 todo）位于主流程尾部；`:1193-1195` 的 `catch` 直接跳到收尾，无 `finally` | 清理只在**成功路径**执行：流程中途 throw（如 `page.evaluate`/`waitForSelector` 抛错）即跳过两处还原，crash-rss 畸形卡与重复 todo 永久留在用户盘上，污染下一轮断言（脚本自己在 `verify-svc.mjs:303` 都承认「残留会污染断言」） | P1 | 清理移入 `finally`（对照 `verify-gallery-live.mjs:337` 的 `finally` + 清理失败显式报错不吞结论）；或直接套用 TST-19 的临时盘方案后无需清理 |
| TST-21 | 创建不清理（grep 证实：全仓 `method: "DELETE"` 仅出现在 mail accounts（`verify-gmail.mjs:93,181`、`verify-mail.mjs:134`）与 plugins（`verify-pl5/6/7/8`），**数据源与凭证零删除**）：`verify-svc.mjs:325-343`（6 个 `svc-*-${uniq}` 数据源）、`verify-live.mjs:149-175`（4 个数据源 + 4 个凭证，凭证内是**真实 secret**）、`verify-mon.mjs:193-194`、`verify-opc.mjs:120`、`verify-i4.mjs:96` | 每轮运行向库内累积数据源/凭证：真机库越跑越脏，且 verify-live 的真实 API key/口令凭证（引用）永久留在凭证库（SEC3 场景下这些是高价值残留） | P1 | 所有 `POST /api/data-sources`、`POST /api/credentials` 的脚本在 `finally` 按本轮 `uniq` 前缀批量 DELETE；verify-live 结束时连带删掉自己建的 4 组凭证+连接 |
| TST-22 | `verify-drag.mjs:41`（`POST /api/kanban/boards` title `drag-${Date.now()}`，无删除）；`apps/web/e2e/journeys.spec.ts:79-96`（J2b 向首页加卡不删）、`:125-168`（J4 加 Todo 卡 + 建任务 `J4-${Date.now()}` 不删）、`:98-123`（J3 建任务不删） | 看板/任务/首页卡片逐轮累积：J2b 断言 `before + 1` 会随累积变慢变脆，真机重复跑 e2e 后首页被测试卡挤满（与 TST-19 叠加） | P2 | e2e 每用例 `afterEach` 清理本轮 `Date.now` 前缀数据并删除本轮新增卡；verify-drag 结束删看板 |

## e2e（Playwright）

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| TST-23 | `apps/web/e2e/journeys.spec.ts`（1 文件 4 用例 J1–J4）vs `apps/web/scripts/verify-j3.mjs`（127 行）、`verify-j4.mjs`（208 行） | J3/J4 在 Playwright 与 puppeteer verify 脚本里**双实现重复维护**（断言集合还不一致，如 verify-j4 多了 SSE 同步断言），改一处漏一处；J5–J8、SVC/PL/live 旅程只有 puppeteer 版，e2e 与 verify 的分工/覆盖矩阵无文档 | P2 | 以 Playwright 为准合并 J3/J4，删除或降级 verify-j3/j4 为薄封装；补一份「旅程 → 执行器」矩阵表（J1–J8 / SVC / PL / live 各自由谁覆盖） |

---

## 存疑（不入台账）

- `verify-live.mjs:105`：`waitForCard` 的就绪条件 `text.includes("探测失败") || text.includes("刷新") && text.length > 120` 运算符优先级导致「探测失败」分支不受 `length>120` 约束，疑为 `(探测失败 || 刷新) && len>120` 笔误；影响仅是提前返回文本，未实测确认，故不入台账。
- `apps/server/src/styles-bridge.test.ts:48` 的 `toBeGreaterThanOrEqual(0)` 疑似弱断言，细看是「桥接段位置」的定位断言（配合下一行 `userAt > bridgeAt` 成立），非假绿。
- 627 条 `ok()` 断言未逐条人工审读（时间盒），仅按模式 grep 审计；弱断言总量可能高于 TST-15 所列。
- `verify-*` 脚本中 `sleep(2500)` 等待卡片取数是否足够，未真机实测，不排除慢网假红。

## 未覆盖范围（本轮时间盒未评完）

- `verify-svc.mjs:730-880` 段未逐行读（已读 1-729、880-1201）。
- `verify-kan/mail/m1/tag/i4/mon/opc/w4/pl5-pl8/gmail/gdrag/d31/fr3/gray/jsx/p8/icons/j3-j8/nfr3/i6/dark/drag` 等 30+ 脚本只做 grep 级扫描（登录/布局/清理/选择器模式统计），未逐行评估断言质量。
- 服务端单测弱断言仅做关键词级 grep（`toBeTruthy`/`toBeDefined`），未逐文件过断言强度。
- 降级分支对照只做透了 `connector/service.ts`（12 个 `best()` 分支）；`gallery.ts`/`navidrome-library.ts`/`portainer-containers.ts`/`mihomo-nodes.ts` 的降级分支与测试的逐一对照未完成。
- 未执行 `pnpm test` / `verify-*.mjs`（按分区约束只读、禁跑），无运行时偶发率数据。

## 条目统计

| 级别 | 条数 | ID |
|---|---|---|
| P0 | 1 | TST-19 |
| P1 | 8 | TST-1、TST-2、TST-5、TST-6、TST-10、TST-11、TST-20、TST-21 |
| P2 | 14 | TST-3、TST-4、TST-7、TST-8、TST-9、TST-12、TST-13、TST-14、TST-15、TST-16、TST-17、TST-18、TST-22、TST-23 |
| 合计 | 23 | |
