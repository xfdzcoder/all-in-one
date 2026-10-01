# 15-docs · 文档全库体检报告

> 分区：`docs/feature-plan/`（01–08 + research/）· `docs/interaction/` · `docs/design-audit/` · `docs/deploy.md` · 根 `AGENTS.md` · `README.md`（根与 apps/web）· `packages/widget-sdk/README.md` · `opencode.jsonc` 注释。
> 重点维度：⑩ 文档 D# 与实现一致性 · 过时/错误文档 · ⑧ 文案统一/i18n · ⑪ 构建产物体积记录 · 文档结构/交叉引用。
> 证据口径：引文 + `文件:行`；实现侧证据引 `apps/web/src`、`apps/server/src`、`packages/widget-sdk/src` 与 07 历轮记录。
> 已抽查凭证泄漏：全库 md 无 token/密钥明文（仅占位符与键名），07 中真机凭证只落 `.opencode/.env.verify` 文件名/键名 ✓。

## 台账

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| DOC-1 | `docs/feature-plan/02-decisions.md:493` | **D55 补记声称"早已在迭代中落地"与事实不符**：原文「本条与 D56/D57 的结论早已在迭代中落地（见 07 队列 Q75–Q78、批 E2）」，但 ECharts/WS **均未实现**——全仓无 `echarts` 依赖与 `useEcharts`（`grep -rn "echarts" apps/web/package.json src` 零命中），07 队列 Q75–Q78 仍为 `[ ]`（`07-iteration-progress.md:188-192`），且执行顺序明确「最后才是批 G/H（Q74–Q78：…ECharts / WS，新功能不阻塞体检）」（`:19`）。三补记中仅 D57（dependsOn，Q72/批E2）真实落地 | P1 | 补记说明改为「决策已定、**实施排在 Q75–Q78（未开工）**」；仅 D57 注明已落地（Q72）；D56 同步加"未实施"标注 |
| DOC-2 | `docs/deploy.md:69`（配合 `docker-compose.yml:16-25`） | **deploy.md 环境变量与 compose 透传不一致**：`deploy.md:69`「`LOG_LEVEL=debug\|info\|warn\|error` 可调」、`:17`「需设 `ALLOW_PRIVATE_OUTBOUND=1`」均只说 export，但 compose `environment:` 块只透传 ADMIN_PASSWORD/CREDENTIALS_MASTER_KEY/ADMIN_USERNAME/COOKIE_SECURE/GMAIL_*（`ALLOW_PRIVATE_OUTBOUND` 仅存在于注释块 `docker-compose.yml:26-29`）——照文档 `export LOG_LEVEL=debug` / `export ALLOW_PRIVATE_OUTBOUND=1` 后 `docker compose up` **静默不生效** | P1 | deploy.md 补一张完整环境变量表（键/默认值/是否需改 compose 透传），明确 LOG_LEVEL、ALLOW_PRIVATE_OUTBOUND、PORT 需写进 compose `environment`；或在 compose 中透传这两个键 |
| DOC-3 | `docs/feature-plan/01-requirements.md:100`（FR-I9） | **FR-I9 语义已被 D61/D62 修订未回写**：原文「媒体墙缩略图等比缩放：**行内等高**、宽度按原始宽高比…（**D60**）」，而 D62 已改为「**全局固定行高** + 行尾留白」（`02-decisions.md:559-569`），且 D60 §2 flex 方案被明示作废（`:543`）。01 仍停留在 D60 初版口径 | P2 | FR-I9 补注「布局语义以 **D62**（全局固定行高 + 行尾留白）为准，D60 §2 已修订」 |
| DOC-4 | `docs/feature-plan/01-requirements.md:111`、`:153`（FR-D3） | **Todo 组件行为描述过时**：`:111`「名称全站唯一」未反映 **D63**（同名分组复用、同一份数据可在任意页面任意次展示，`02-decisions.md:571-581`）；`:153` FR-D3「Todo/RSS 组件配置『展示哪些标签』」——Q29b 已移除 Todo 组件的标签/筛选按钮（`07:102`「widget 去标签/去筛选按钮、显示三档」；manifest 仅剩 `name`+`filter`，`apps/web/src/widget-registry.ts:34-63`），标签筛选现仅 RSS 保留 | P2 | FR-D3 改为「RSS 组件按标签选数据（Todo 侧标签筛选已随 Q29b 下线，归属改卡片名称 D43/D63）」；`2.3` Todo 行补 D63 语义 |
| DOC-5 | `docs/feature-plan/01-requirements.md:132`（FR-W6）、`:142-143`（FR-E3/E4）、`:114-121`（§2.3 排后表） | **FR 状态与实现长期不符（⑩）**：FR-W6 插件管理标【暂不考虑】（二期），但插件管理页已落地（Q5d-1，`07:209`）；FR-E3 邮件/FR-E4 OpenCode 标【暂不考虑】（首版）但已落地（Q7/Q8，`07:36-40`）；§2.3 排后 4 项（Kanban/邮件/监控/OpenCode）全部已实现（06 §1 逐项标 ✅）。01 只对新增项（§2.7 FR-X）做了回写，存量状态行漏更新 | P2 | 给已落地的 FR/排后行统一补「✅ 已落地（Qx，见 06 §1）」状态标注，与 §2.7 FR-X 的回写风格一致 |
| DOC-6 | `docs/feature-plan/01-requirements.md:152`（FR-D2）、`docs/feature-plan/02-decisions.md:362`（D42 §4） | **数据源管理页签清单少一项**：FR-D2「统一入口管理 Todo / 信息源 / 标签」、D42「页签 = 任务 / 信息源 / 看板 / 邮箱 / 数据连接 / 标签」，实现另有「**图标**」页签（Q38b，`07:118`「数据源管理『图标』页签」）；且 Q29b 后任务页签为「单 ToDo 视图」（下拉切换+分组，`07:102`） | P2 | FR-D2 补「图标」页签与任务页签现状；D42 为历史决策不动，另在 07/01 标注页签演进 |
| DOC-7 | `docs/interaction/pages/02-workspace.md:63-124`（「组件 · 页签栏」整节） | **页签栏整节过时**：Q27d 已把「页签 → 右上角弹出切换器（页面管理一并收纳）」（`07:96`；实现 `App.tsx:254` `Popover`「切换页面」弹层内含 新建页面/上移/下移/删除此页，`App.tsx:288-303`）。文档仍描述「头部下方一行 Dashboard 页签（横向滚动）」（`:15`）、「新建页面输入框 + 页签列表右侧」（`:76-82`）、「上移/下移」「删除此页」位于页签栏（`:107-124`），截图 `p06-workspace-tabbar` 亦为旧 UI | P2 | 该节改写为「页面切换器（弹层）」：触发按钮位于头部右侧、弹层内列表 + 新建/上移/下移/删除；重截 p06 |
| DOC-8 | `docs/interaction/pages/02-workspace.md:73` | **ISS-3 描述未随修复更新且与本文件末尾矛盾**：`:73`「⚠ ISS-3 —— 活动页签不持久化，刷新回第一个页签，无法深链」，而 `:136`「~~ISS-1/2/3/5/7~~ ✅ 已修（Q24b/c + D41）」；Q24b 已落 `?page=` 深链（`07:77`） | P2 | `:73` 改为「~~ISS-3~~ ✅ 已修（Q24b：`?page=` URL 持久化）」 |
| DOC-9 | `docs/interaction/pages/02-workspace.md:130`、`:136` | **ISS-4 描述过时**：`:130`「错误条…——⚠ ISS-4：实际无重试调度」，Q24a 已改为真·退避自动重试 5s→30s（`07:76`「ISS-4（布局保存真·退避自动重试 5s→30s）」）；`:136`「已修」清单又漏列 ISS-4 | P2 | `:130` 改为「失败展示错误条并 5s→30s 退避自动重试（ISS-4 ✅ Q24a）」；`:136` 补 ISS-4 |
| DOC-10 | `docs/interaction/pages/02-workspace.md:43-48`（按钮 · 数据源管理） | **三重过时且文内自相矛盾**：① `:45`「位置：『编辑布局』右侧（**仅桌面端**）」与 `:48`「全端可见（含移动端）」冲突（D41 已放开移动端）；② `:46`「打开『数据源管理』**弹窗**（Todo / 信息源 / 标签 **三页签**）」——Q25c 已改**独立全页视图**（`?view=data` 深链，`07:84`），页签已扩为 任务/信息源/看板/邮箱/数据连接/标签/图标；③ `:47`「拉取 `/api/todos` `/api/feeds` `/api/tags`」为三页签时代的取数描述 | P2 | 改写为「头部按钮（全端，D41）→ 数据源管理**全页视图**（`?view=data`），页签 任务/信息源/看板/邮箱/数据连接/标签/图标」 |
| DOC-11 | `docs/interaction/pages/02-workspace.md:86-88` | **内联页面设置字段缺 2 项**：文档列「页面名称 / 图标（emoji）/ 背景色」，实现另有「网格列数 / 网格行高（px）」（Q91/D58，`App.tsx:436-460` 五字段；`07:347` Q94 还统一了 5 字段 label 对齐） | P2 | 补「网格列数（12/16/20/24/28/32）/ 网格行高（40–200px）」两字段与约束（FR-P9/D58） |
| DOC-12 | `docs/interaction/pages/02-workspace.md:131` | **断点描述过时**：「响应式（D12/D39）：断点 12/8/4/1 列（≤480px 单列全宽）」——Q91/D58 后断点按页面列数 `N → N/2 → N/4 → 1` 推导（`Board.tsx:72-73`），列数 12–32 可配 | P2 | 改为「断点按列数档位推导 N→N/2→N/4→1（阈值 1200/900/600/480）」 |
| DOC-13 | `docs/interaction/components/`（缺篇）+ `service-overview.md:55` | **4 个深度组件零文档 + 一句结论已失效**：`widget-registry.ts:14-17` 注册 ImmichGallery/NavidromeLibrary/PortainerContainers/MihomoNodes 四组件（Q50–Q53 落地），`components/` 仅 12 篇无一篇覆盖；`service-overview.md:55`「深度操作（照片墙/播放/容器操作/代理切换）**不提供**（FR-X3 二期另立需求）」与 FR-X3 只读深度已落地（01:162、07:141-144）矛盾 | P2 | 补 4 篇组件文档（照 `todo.md` 模板）；`:55` 改为「只读深度组件已落地（D50/Q50–Q53）；写操作仅 Portainer 重启（D51/Q56），Navidrome/Mihomo 写操作已 D54 移除」 |
| DOC-14 | `docs/interaction/00-button-index.md:20,32,34,38,39,43,45,50,52,55,58,59,60,69,71,75` | **「问题」列大量已修 ISS 未划除**：ISS-5/15/16/17/19/20/21/23/25 等仍以原样列在问题列，而 `00-issues.md:276`「**26/26 全部修复**」、各 ISS 正文多已标「✅ 已修」；README 自身要求「问题条目…应清零或标注已知问题」（`interaction/README.md:59`） | P2 | 问题列统一加 `~~ISS-#~~ ✅` 或清空；与 00-issues 收口口径同步 |
| DOC-15 | `docs/interaction/00-button-index.md:17-21`、`:50` | **位置/入口过时**：`:17-21` 页签栏各行（页签/新建页面/上移下移/删除此页）位置应为「页面切换器弹层」（Q27d，见 DOC-7）；`:50`「邮件 \| 管理账号 \| 账号管理弹窗」——Q68 已删「管理邮箱」按钮（`07:168`「删『管理邮箱』按钮（空态文案改指『数据源管理 · 邮箱』）」），邮件.md:42 已写「跳转『数据源管理 · 邮箱』」，索引未同步 | P2 | 同步位置列与邮件行；补 Q68 后行为 |
| DOC-16 | `docs/interaction/components/todo.md:43`、`:67`；`00-button-index.md:30` | **Todo 组件描述未跟 Q24a/Q29b**：`:43`「空标签库时弹窗提示去『数据源管理』创建」与按钮索引 `:30`「Todo \| 筛选 \| 标签勾选（写回+服务端过滤）」描述的标签筛选已随 Q29b 移除（`07:102`；现配置仅 `name`/`filter` 三档）；`:67`「⚠ **ISS-14**…无法撤销」——Q24a 已加 6s 撤销条（`07:76`、`00-button-index.md:33` 自己已写「完成后『撤销』条」），文内矛盾 | P2 | todo.md 删标签筛选条目、补「显示」三档与 6s 撤销；`~~ISS-14~~ ✅` |
| DOC-17 | `AGENTS.md`（维护约定段「当前决策 D1–D22」；命令段「M3 计划 Playwright J1–J4」） | **AGENTS.md 两处过时**：① 「当前决策 D1–D22」——02 实际已到 **D63**；② 「UI 行为验证…**M3 计划** Playwright J1–J4」——Playwright J1–J4 已 5/5 落地（`05-mvp.md:74`），另「apps/server：M1 已完成」也远落后于现状（M2/M3 + Q1–Q94 均已交付）。D53 提交即推送段 ✓ 为最新 | P2 | 改「当前决策 D1–D63」；「M3 计划」改「已落地（J1–J4 5/5）」；apps/server 概述更新 |
| DOC-18 | `AGENTS.md`（「MVP 里程碑与进度见 `05-mvp.md` / `README.md`」）+ 仓库根 | **悬空引用/缺根 README**：仓库根**无 `README.md`**（`git log --all -- README.md` 零提交），AGENTS.md 的 `README.md` 指向不明（易被读作根 README）；`07:204`「README 测试状态同步」同样无从落地到根 README | P2 | 明确写作 `docs/feature-plan/README.md`，或补一份根 README（项目简介/快速开始/文档索引） |
| DOC-19 | `docs/feature-plan/README.md:10` | **索引状态过时**：「决策日志 **D1–D38**」——实际 D1–D63（`02-decisions.md` 含 D55–D63 补记） | P2 | 改「D1–D63（随迭代追加）」 |
| DOC-20 | `packages/widget-sdk/README.md:46`（字段类型）、`:35-51`（配置表单节）、全文 | **契约文档落后于契约代码（D48「契约变更先改契约与文档」未兑现）**：① `:46`「字段类型：`text \| number \| boolean \| select \| json \| secret`」缺 **`textarea`** 与 **`multiselect`**（`config.ts:7-18`）；② 未文档化 **`dynamic`/`dependsOn`/`creatable`**（`config.ts:32-41`，D57 明说「插件契约（D7）可跨语言读取该字段」）；③ 全文未提 **`uniqueField`**（D63 语义声明，`manifest.ts:17-28`） | P2 | README 补全字段类型与 `dynamic/dependsOn/creatable` 说明、`uniqueField` 语义（注明「不触发拒绝」） |
| DOC-21 | `apps/web/README.md:14`、`:16` | **结构说明过时**：`:14`「`src/App.tsx` — …（页面 **Tab**、新建/删除）」——Q27d 后为右上角页面切换器弹层；`:16`「`src/widgets.tsx` / `widget-registry.ts` — **占位组件**与组件映射（**M2 换成** widget-sdk 注册表）」——M2 早已完成，注册表现含 16 个内置组件 | P2 | 按现状改写（切换器弹层；widget-registry = 16 内置 manifest + 组件映射） |
| DOC-22 | `opencode.jsonc:22` | **注释与 D53 矛盾**：「本地提交（D22 允许；每批次一条，**不 push**）」——D53 已定「提交即推送」，同文件 `:36-40` 也已放行 `git push origin main`；同段 `:3`「权限：自主迭代 loop（D22）」未提 D53 | P2 | 注释改为「本地提交（每批次一条；D53：门禁全绿后 `git push origin main`）」 |
| DOC-23 | `docker-compose.yml:3` | **备份文档指向错误**：「备份/恢复见 **docs/feature-plan/06-roadmap.md** 与下方注释」——备份/恢复正文在 `docs/deploy.md:19-34`，06-roadmap 无备份章节 | P2 | 改指 `docs/deploy.md` |
| DOC-24 | `docs/deploy.md:3`、`:11` | **两处小瑕疵**：`:3`「Docker Compose（推荐，**G15**）」——01 目标仅 G1–G5，无 G15（失效引用/typo）；`:11`「首次访问 **http://192.168.31.133:3000**」硬编码作者局域网 IP，对其他部署者是错误指引 | P2 | 删「G15」或改为正确需求号；IP 改 `http://<宿主机IP>:3000` |
| DOC-25 | `docs/feature-plan/03-tech-analysis.md:9` | **gridstack 版本口径不一**：K1 表仍写「gridstack.js（**v13**，官方 React wrapper）」，无勘误指针；04 已更正为「实测 v14」（`04-tech-stack.md:26`）、AGENTS 也注明「文档中的 v13 已过时」 | P2 | `:9` 补「（文档时点 v13，实测 v14，见 D12 spike 结论）」 |
| DOC-26 | `docs/feature-plan/research/00-service-metrics.md:22`、`:50`、`:54`、`:99` | **指标映射表含已下线指标未标注**：「正在播放」行（`:99`「现在谁在听什么 → 正在播放 → getNowPlaying」等）对应的清单已被 Q94 整体删除（`07:347`「移除『正在播放』…连同 getNowPlaying 取数一并删」，服务概览与专辑墙两处）；research 是 08 §2 的指标映射留痕载体，未标下线易被后来接入当现行契约 | P2 | 在相关行加「（Q94 已下线，勿再纳入）」标注；08 §3 清单层说明同步 |
| DOC-27 | 全库（⑧ 术语） | **术语不统一（⑧ 文案统一/i18n）**：① 「ToDo」/「Todo」混用（`02-decisions.md:388`「（Q29b，用户反馈⑩ **ToDo** 重构）」、`07:100`、`research/01-mihomo-overview-metrics.md` 3 处、`interaction/components/todo.md:67`）vs 全站「Todo」；② 「信息流」/「RSS」并存（`01:112`「RSS / 信息流」、交互文档两种混用）；③ 「数据管理面/数据管理」/「数据源管理」并存（`01:152`「数据管理面」vs Q25c 起全站统一「数据源管理」（`07:84`）；07 内「数据管理」「数据管理面」多处） | P2 | 定术语表（建议：组件名 Todo / 页面名 数据源管理 / 组件名 RSS·别名信息流）并一次性替换；至少在 01/02 首次出现处统一 |
| DOC-28 | `docs/feature-plan/02-decisions.md:498`、`docs/feature-plan/06-roadmap.md:39`（维度⑪） | **构建产物体积无任何实测记录（⑪）**：D55「构建体积需在收口时复核（见刮骨疗毒清单「构建产物体积」）」、06 #7 ⑪「构建产物体积（ECharts 引入后）」均悬空；全库文档无 `apps/web/dist` 体积/首屏 JS/gzip 记录。NFR3 首屏 <2s 反而有实测（`07:228` 轮 27：verify-nfr3 登录页 89ms、首屏中位 91ms，localhost 画像）但 01 NFR3 行未链接该记录 | P2 | 把 verify-nfr3 结果回链到 01 NFR3；Q96/Q97 收口时新增「构建产物体积」记录页（dist 体积、chunk 明细、引入 ECharts 前后对比） |

## 存疑（不入台账）

- `AGENTS.md`「MVP 里程碑与进度见 `05-mvp.md` / `README.md`」——若原意即 `docs/feature-plan/README.md`，则 DOC-18 降为措辞问题；未见根 README 的需求出处，无法断定是"漏建"还是"故意不建"。
- `docs/design-audit/00-visual-audit.md` / `02-custom-css.md` / `03-style-v2.md` 与 D39/D52 的对照未逐行核（仅确认 02-custom-css 与 D39 三层契约方向一致）；D52 之后 tokens v2 的文档细节是否同步未验。
- `05-mvp.md` 完成态标注抽查一致（M0–M3 ✅ 与 07 记录对得上、出口标准勾选含全绿记录），未发现虚报。
- D10「手机/平板完全禁止布局编辑」与实现阈值 `useMediaQuery("(min-width: 768px)")`（`App.tsx:91`）：768–1023px 平板竖屏**可以**编辑布局——属"文档/决策与实现口径差"还是代码缺陷（应收紧阈值），需产品拍板，交 11-web / 用户确认裁定。
- 07-iteration-progress「历轮记录」（352 行）只抽查了 Q79/Q83/Q86/Q94 等关键轮次，未逐轮对账 commit 哈希与描述。

## 未覆盖范围（时间盒收尾，未深挖）

1. `docs/interaction/components/{rss,kanban,mail,monitor,opencode,launcher,iframe,custom-api,placeholder-statbox,plugin-widget}.md` 逐条与 UI 对照（仅抽查 todo/kanban/mail/service-overview/data-admin）。
2. `docs/interaction/surfaces/*`（config-form/confirm/detail-modals/plugin-admin/plugin-runtime/widget-picker/data-admin 全文）与 `pages/01-login.md`、`03-edit-mode.md` 全文对账。
3. `docs/feature-plan/03-tech-analysis.md` K2–K8、`research/01-mihomo-overview-metrics.md`、`07` 历轮记录全量逐条核验。
4. 全库 markdown 链接/锚点**逐条**存在性校验（仅人工抽查了 README 索引、06→02、08→research、interaction 目录链接，未跑脚本遍历）。
5. 中英混排规范、typo 逐行细查；截图资产与现实 UI 的一致性（p06-tabbar 等已知过时见 DOC-7，其余未核）。
6. `opencode.jsonc` 之外的 `.opencode/loop-prompt.md`、skill 文档与 D22/D47 流程一致性（属边界文件，未纳入本分区逐行评估）。

## 条目统计

| 级别 | 数量 |
|---|---|
| P0 | 0 |
| P1 | 2（DOC-1、DOC-2） |
| P2 | 26（DOC-3 … DOC-28） |
| **合计** | **28** |
