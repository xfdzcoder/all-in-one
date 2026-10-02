# 决策日志（ADR 风格）

每条决策含：背景 / 决策 / 影响 / 被否备选。决策编号 `D#` 在其他文档中引用。

标记：**已决** = 已确认生效；**待确认** = 尚未拍板。

---

## D1 · 单用户优先，架构预留多用户与公网

- **状态**：已决
- **背景**：当前严格单用户、仅局域网访问，但未来可能多用户、公网可访问。
- **决策**：首版只实现单用户；设计上为多用户/公网留有余地；登录鉴权使用账号密码。
- **影响**：鉴权与数据模型预留用户归属维度；安全基线按"未来会公网"标准设计，但首版不实现多租户；SEC2/SEC7 相应定义。
- **被否备选**：首版即完整多用户（过度设计）；无鉴权局域网裸奔（与公网预留矛盾）。

## D2 · 移动端是一等公民

- **状态**：已决
- **背景**：手机使用是核心场景之一。
- **决策**：移动端必须良好可用，纳入首版验收（NFR2）。
- **影响**：布局引擎必须支持断点自动重排；触控目标、窄屏交互纳入验收旅程 J3。
- **被否备选**：桌面优先、移动可用即可（体验降级）。

## D3 · 邮件只读聚合

- **状态**：已决
- **背景**：邮件组件若含回复/归档等写操作，复杂度与安全面大幅上升。
- **决策**：本版本邮件只做只读聚合（列表 + 正文），不设计回复、归档等写操作。
- **影响**：邮件 connector 仅需 IMAP 读取与缓存；FR-E3 范围收敛；写操作列入 06-roadmap。
- **被否备选**：首版完整邮件操作（工作量与风险不可控）。

## D4 · 必须设计第三方/自定义 Widget 插件机制

- **状态**：已决
- **背景**：可扩展性优先于一次性堆功能；新增组件不应要求大幅修改核心。
- **决策**：插件机制是一等公民设计对象，需定义统一契约（manifest/configSchema/生命周期/数据通道）与信任、沙箱模型。
- **影响**：`packages/widget-sdk` 独立成包；FR-W5/FR-W7 硬性要求；实现深度见 D7。
- **被否备选**：仅内置组件、无扩展规范（违背扩展性原则）。

## D5 · iframe 本身是一种 Widget

- **状态**：已决
- **背景**：部分第三方界面（如 Portainer）原生组件覆盖成本高，可嵌入过渡。
- **决策**：接受 iframe 嵌入，且 iframe 是官方内置 Widget 类型之一。
- **影响**：iframe Widget 进入首版组件清单（D8）；需沙箱属性 + CSP + 禁嵌提示（SEC5）；受目标站 X-Frame-Options 限制为已知硬约束。
- **被否备选**：全部要求原生组件（不现实）；iframe 仅作开发期 hack（失去产品化价值）。

## D6 · 移动端布局 = 单一布局自动重排

- **状态**：已决
- **背景**：K1 核心权衡——"同布局自动重排"与"每断点独立布局"二选一。
- **决策**：手机砍掉"独立编辑布局"能力，所有断点共享同一布局、自动重排。
- **影响**：布局引擎选型压力解除（gridstack 与 RGL 均回候选）；持久化只需一套布局数据；FR-P6 已决。
- **被否备选**：每断点独立布局（体验略优但双倍编辑心智 + 引擎绑定）。

## D7 · 插件分层：规范先行，代码插件放二期

- **状态**：已决
- **背景**：D4 要求插件机制，但运行时安装第三方代码是最大安全面。
- **决策**：首版 = ① 内置组件按规范实现 + ② 零代码组件（iframe、自定义 API）；③ 代码级插件的运行时安装/管理放二期，但契约规范首版即定义并由内置组件验证。
- **影响**：FR-W5 三档分层中 ③ 首版仅规范不实现安装器；D4 以"规范先行"方式满足；安全面大幅收敛。
- **被否备选**：首版即可安装第三方代码插件（安全与工作量风险）；不设计 ③ 规范（二期重构）。

## D8 · 首版组件清单

- **状态**：已决
- **背景**：8 类计划组件需冻结首版范围。
- **决策**：首版 = iframe、应用入口+服务状态、自定义 API、Todo、RSS；排后 = Kanban、多邮箱聚合、服务器监控、OpenCode 会话。
- **影响**：产品定义范围冻结；排后项进入 06-roadmap；J1–J8 旅程对应首版组件。
- **被否备选**：全部 8 类进首版（范围失控）。

## D9 · 多用户/公网仅架构可扩展

- **状态**：已决
- **背景**：D1 的深度问题——仅架构预留还是首版落库。
- **决策**：仅架构可扩展（数据表带归属字段、安全设计不堵死）；首版不实现多用户表结构的完整多租户语义，也不实现公网安全项（HTTPS 强制、限流、审计）。
- **影响**：NFR5 = 表结构预留归属；SEC6 标记为"公网化前必须完成"；架构选型（会话归属、ORM 双方言）为此服务。
- **被否备选**：首版即落库多用户 + 公网安全项（工作量超范围）。

## D10 · 手机/平板禁止布局编辑

- **状态**：已决
- **背景**：D6 砍掉手机独立布局后，是否保留触屏拖拽编辑共享布局。
- **决策**：手机/平板**完全禁止**布局编辑（仅浏览 + 组件内操作），布局编辑仅桌面端。
- **影响**：触屏拖拽需求消失；布局引擎只需鼠标 DnD + 断点自动重排；编辑入口按视口隐藏；NFR2 定义为浏览/操作可用性。
- **被否备选**：保留触屏编辑共享布局（误触风险、体验不稳）。

## D11 · 全栈 TypeScript

- **状态**：已决
- **背景**：后端候选 Node/Go/Python 的权衡。
- **决策**：React + TypeScript 前端，Node.js + TypeScript + Fastify 后端，SQLite + Drizzle，共享契约包 monorepo。
- **影响**：Widget 契约（manifest/configSchema）前后端/插件单一来源；OpenCode SDK 原生 TS（未来）；单人维护一种语言；04-tech-stack 冻结。
- **被否备选**：Go 后端（部署更轻但双语言 + 契约共享成本）；Python/FastAPI（契约共享弱）；NestJS（结构重）。

## D12 · 布局引擎：gridstack 优先，spike 验证，RGL 备选

- **状态**：已决
- **背景**：K1 对比 gridstack.js 与 react-grid-layout，D6/D10 后差距收窄。
- **决策**：gridstack.js v13（官方 React wrapper）优先；MVP 第一里程碑做 1–2 天真实页面 spike（拖拽/缩放/断点/保存），不合格即切 react-grid-layout。
- **影响**：布局引擎封装在 `apps/web` 内部，不泄漏进 widget-sdk 契约（关键隔离点）；两条路架构均允许。
- **被否备选**：自研网格（违背成熟开源原则）；直接锁死不验证（wrapper 较新风险）。
- **Spike 结论（2026-09-28）**：✅ 通过，**保留 gridstack**。实测解析到 **gridstack v14**（文档时点为 v13，API 已变化：`mode: "float"` 取代 `float: true`，断点用 `columnOpts.breakpoints` 的宽度上界语义）。自动化验证 7/7 通过：4 widget 初始渲染、`save()` 输出布局 JSON、鼠标拖拽移位、SE 手柄缩放、断点重排（12 列 ↔ 2 列）、`load()` 恢复、恢复位置与 JSON 一致。注意项：React wrapper 的 `useGridStack()` 须在 `<GridStack>` 子树内使用（工具栏等 host UI 作为 children 传入）；缩放手柄默认 autohide，hover 显现（正常交互即触发）。

## D13 · UI 组件库：Mantine

- **状态**：已决
- **背景**：Mantine 与 shadcn/ui + Tailwind 的权衡。
- **决策**：Mantine。
- **影响**：配置表单（FR-W2）开发快；Homarr 同款（自定义组件模板思路可借鉴）；包体积略大为已知代价。
- **被否备选**：shadcn/ui + Tailwind（轻量可控但表单/弹层需自攒）；AntD（重）。

## D14 · 自定义 API 组件渲染 = 声明式白名单模板

- **状态**：已决
- **背景**：自定义 API Widget 的数据渲染方式（安全 vs 灵活）。
- **决策**：声明式白名单模板（预设：统计卡片/列表/状态点/原始 JSON + 白名单模板变量），无代码执行。
- **影响**：SEC5 天然满足；表达力有限为已知代价，Raw JSON 兜底；二期可升级受限 JS 模板（06-roadmap）。
- **被否备选**：受限 JS/JSX 模板（灵活但引入执行沙箱负担）；仅 Raw JSON（太弱）。

## D15 · MVP 范围决议（里程碑边界与测试门槛）

- **状态**：已决
- **背景**：MVP 定义（05）中两个需拍板的范围点。
- **决策**：① RSS 组件放 M3（M2 聚焦契约 + Todo + 自定义 API 打深）；② MVP 出口测试门槛 = Playwright J1–J4 全绿 + J5–J8 手工验收脚本化记录。
- **影响**：M2/M3 交付物边界与 05-mvp §6/§7 定稿。
- **被否备选**：RSS 提前至 M2；全部旅程强制自动化。

## D16 · SQLite 驱动：libsql 本地文件（开发期简决）

- **状态**：已决
- **背景**：M1-② 落地 Drizzle + SQLite(WAL) 时，`better-sqlite3` 需 node-gyp 原生编译，本机/CI 环境缺少构建链，安装失败。
- **决策**：使用 `@libsql/client` 的 `file:` 本地 URL 作为 Drizzle 驱动（`drizzle-orm/libsql`），库文件仍是标准 SQLite，启用 WAL。对外仍是「SQLite + Drizzle」栈（04 不变）。
- **影响**：运行时多一层 libsql client；备份仍为拷贝 `data/app.db`（含 `-wal`/`-shm`）。若日后需要 better-sqlite3，可只换 `db/client.ts` 适配层。
- **被否备选**：强装 node-gyp/better-sqlite3（环境脆弱）；node:sqlite 直写（放弃 Drizzle，违背 D11）。

---

## D17 · 初始账号口令：强制 ADMIN_PASSWORD 环境变量

- **状态**：已决
- **背景**：M1-③ 复盘发现一次性口令经 `console.log` 打印与 SEC3"凭证不入日志"冲突（Docker logs 留存泄漏面）。两方案：保留一次性打印（记风险）vs 强制环境变量。
- **决策**：**强制 `ADMIN_PASSWORD` 环境变量**。首启无该变量则启动失败并给出明确报错；不再生成/打印随机口令。`ADMIN_USERNAME` 可选（默认 `admin`）。
- **影响**：J1 交接方式变为"部署时注入环境变量"；`ensure-user.ts` 失败快（fail-fast）；SEC3 边界更干净。
- **被否备选**：console.log 一次性口令（日志泄漏面）。

## D18 · DB 迁移机制：drizzle-kit（单源）

- **状态**：已决
- **背景**：M1-② 用 Drizzle 表定义 + 手写 `SCHEMA_DDL` 双源人肉同步，且 `IF NOT EXISTS` 无迁移能力（改列不生效）。复盘定级 P1。
- **决策**：引入 **drizzle-kit**：`schema.ts` 为唯一源，`drizzle-kit generate` 生成 SQL 迁移文件，启动时 `drizzle-orm/libsql/migrator` 应用。删除手写 `SCHEMA_DDL`。
- **影响**：schema 演进（M2 Todo/RSS 等）走迁移文件，升级不丢数据；测试覆盖迁移可重复执行。
- **被否备选**：继续手写 DDL + IF NOT EXISTS（无迁移能力）；ORM 自动 sync（不可控）。

## D19 · 推进方式：手动批次（不恢复定时 loop）

- **状态**：已决
- **背景**：复盘发现定时任务静默消失、自动推进链断裂（详见复盘记录）。
- **决策**：**不恢复自动 loop**，转为用户确认的手动批次推进；每批次完成后汇报，等确认再继续。
- **影响**：推进节奏由用户控制；批次划分见复盘计划 A–D。

## D20 · 开发期简决回写（会话/cookie/库路径）

- **状态**：已决
- **背景**：M1-②③ 若干开发期简决未按维护约定回写决策日志（复盘 P2）。
- **决策**：统一补记：① 会话 TTL = 30 天；② Cookie `secure` 默认关、`COOKIE_SECURE=1` 开启（LAN/HTTP MVP，公网化随 SEC6 强制）；③ PRAGMA `journal_mode=WAL` + `foreign_keys=ON` 为启动必做（D16 附带）；④ 默认库路径 `file:./data/app.db`（相对 CWD，启动时解析为绝对路径）。
- **影响**：消除"未记录简决"缺口；后续变更照常追加新 D#。

## D21 · Workspace 实体形态：`user_id` 代位（业务表归属字段）

- **状态**：已决
- **背景**：06-roadmap 待定 #6 —— 概念模型"Workspace 拥有数据"（01 §1.3）在 schema 中如何落地：引入独立 `workspace` 表 vs 继续用 `user_id` 代位。M2 起建 Todo 等业务表前必须定案。
- **决策**：**继续 `user_id` 代位**，不引入 `workspace` 表。所有业务表（`credential`、`todo` 及后续 RSS/Kanban）带 `user_id` 归属字段（NFR5），该字段同时就是 Workspace 归属——单用户下 Workspace 唯一且恒等于该 user（01 §1.3"首版简化"）。
- **影响**：概念模型不变（数据归 Workspace / 布局归 Dashboard / Widget 只引用数据）；未来多用户时为 user 建默认 workspace 并把 `user_id` 迁移为 `workspace_id` 或加映射表即可，属机械迁移。M2 Todo 表直接落 `user_id`。
- **被否备选**：现在引入 `workspace`/`workspace_member` 表（单用户下纯属空转，违背 D9 仅架构可扩展与避免过度设计）。

## D22 · 迭代推进方式：自主迭代 loop（授权与边界，取代 D19 的"不恢复 loop"）

- **状态**：已决
- **背景**：MVP（M0–M3）与部署完成后进入迭代阶段（06-roadmap）。用户明确要求开启**长期可自我迭代**的推进会话、直至收到停止指令，这推翻了 D19"不恢复定时 loop、手动批次推进"的约定。自主模式与 AGENTS.md"未经确认不进入下一阶段"的门控冲突，需要明确授权与边界。停止方式否决 `--until` 文本条件（该机制会全仓扫描 .md/.txt，易误命中关键词）。
- **决策**：采用 **`@bybrawe/opencode-loop` 插件**驱动自主迭代 loop：新开专门迭代会话（不续用旧会话，上下文由 docs/feature-plan 承接），`/loop` idle 自动续跑，`--progress-file docs/feature-plan/07-iteration-progress.md`、`--prompt-file .opencode/loop-prompt.md`、`--stop-file .opencode/opencode-loop/STOP`、`--verify "pnpm test" --pause-on-verify-fail`、`--batch 1`。**授权范围**：① 实现代码 + 自测 + 本地 `git commit`（每批次单独一条，英文 conventional commits）；② 自主选择并推进 06-roadmap 迭代项（仅在迭代阶段内豁免"未经确认不进入下一阶段"门控）；③ 按维护约定更新 01/02/06/07 文档；④ 本地构建与 Docker 部署验证。**禁止**：`git push` 及任何远端外发（`opencode.jsonc` permissions 显式 deny）、凭证入日志/前端明文、实现 01-requirements §1.2/§2.3 非目标、破坏性 shell 操作。
- **停止与恢复**：会话内发「停止」类指令（agent 按协议写 stop-file 暂停），或直接 `/loop-stop`、`/loop-pause`（`/loop-resume` 恢复）、`/loop-clear`（清除）。停止后由用户决定是否继续。
- **影响**：迭代阶段由 loop 自动驱动，每轮产出落盘 07-iteration-progress.md 供人工审计；权限基线见项目 `opencode.jsonc`；需求/决策变更仍走维护约定（追加 D#，不改写历史）。D19 保留原文，其"不恢复 loop"部分自本条起被取代。
- **被否备选**：维持 D19 手动批次（不满足长期自主诉求）；`--until` 文本条件停止（全仓扫描易误命中）；外部脚本循环调 `opencode run`（无 idle 感知/verify/checkpoint 等能力）；`@bojackduy/opencode-loopd` 目标引擎（形态过重，引入独立子代理体系）。

## D23 · iframe 禁嵌检测：服务端响应头判定（取代前端超时启发式）

- **状态**：已决
- **背景**：J7 验收脚本化（迭代第 2 轮）实测发现 M3-③ 的禁嵌提示**从未生效**：Chrome 在 X-Frame-Options / CSP frame-ancestors 拒绝嵌入时仍触发 iframe 的 `load` 事件（frame 内载入错误页），`timedOut && !loaded` 启发式的前提不成立；同时空字符串配置值绕过默认沙箱（`sandbox ?? DEFAULT_SANDBOX` 对 `""` 不生效 → 全禁沙箱）。
- **决策**：禁嵌判定改由**服务端 connector（`iframe-embed`）读响应头**完成（X-Frame-Options deny/sameorigin/allow-from、CSP frame-ancestors 匹配 parentOrigin），前端据判定给出明确提示 + "新标签页打开"逃生口；不可达 / 重定向超限时**不误报**（verified:false，正常渲染）。目标多为内网面板（Portainer 等，J7 主场景）→ 走 allowPrivate 通道（同 app-launcher，D22），逐跳 SSRF 校验、不自动跟随跳转。沙箱空值回落最小集 `allow-scripts`。
- **影响**：SEC5"禁嵌明确提示"真正可用；iframe manifest 移除已无意义的 `timeoutSec` 配置（旧布局残留值被忽略），capabilities.data 由 none 改为 http-connector；新增 13 项单测（判定规则 + connector 含重定向跳/不可达）。
- **被否备选**：保留前端超时启发式（前提不成立，永不触发）；前端 `contentDocument` 探测（跨域一律不可读，无法区分禁嵌）；仅 HEAD 探测（部分面板不响应 HEAD）；前端直连读响应头（违反"前端只消费工作台 API"不变量且浏览器受 CORS 限制）。

## D24 · 代码级插件 ABI：契约先行（PluginManifest + 权限白名单 + apiVersion）

- **状态**：已决
- **背景**：迭代队列 Q5（二期·代码级插件，FR-W5③/FR-W6/FR-W7）启动。D7/K3/K7 已定原则（契约先行、实现分层；仅前端渲染 + 宿主统一数据通道；管理员安装、权限显式声明默认最小化），但 ABI 未冻结——安装器/运行时落地前必须先定死包格式、权限语义与版本兼容，否则插件无法互操作。
- **决策**：widget-sdk 新增 `PluginManifest = WidgetManifest + { plugin: { entry, apiVersion, permissions? } }`：① `entry` 为插件包内相对 ESM 模块路径（禁绝对路径与 `..`/隐藏段穿越，`isSafePluginEntry`）；② `apiVersion` semver（与宿主主版本一致才可启用）；③ `permissions` 为显式白名单（`apis` / `credentialKinds` / `actions`），**缺省 = 最小权限**（仅数据通道、无凭证、无动作），未知权限键一律拒绝（`validatePluginManifest`）。插件包 = zip（`manifest.json` + entry 模块 + 可选资源）。
- **影响**：Q5 后续步骤（上传/校验/存储、运行时沙箱加载、管理页与权限执行）都以本 ABI 为准；权限执行 = 宿主按白名单放行、越权拒绝。06 §1「代码级插件」进入实施。
- **被否备选**：manifest 不带版本（宿主升级无法判兼容，K3 风险）；权限隐式推断/默认全开（违背 K7 显式最小化）；插件自带服务端 connector 代码（K7 明确最后考虑，最大攻击面）；等待运行时实现后再补契约（D7 明确契约先行）。

## D25 · 插件运行时沙箱：iframe CSP（否决 Web Component）

- **状态**：已决
- **背景**：Q5c 落地 FR-W7 插件沙箱隔离（FR-W7/K7 已列二选一：iframe CSP / Web Component）。插件是不可信第三方 JS；K7 要求"仅前端渲染 + 宿主统一数据通道、插件不直连第三方"。Web Component/Shadow DOM 只隔离样式、**不隔离 JS**（同 realm，插件可触及宿主 window / 凭证引用 / fetch）。
- **决策**：**iframe sandbox 沙箱**：`sandbox="allow-scripts"`（不加 allow-same-origin → 不透明源，碰不到宿主 DOM/cookie/storage）+ srcdoc 内 CSP（`default-src 'none'`、`script-src 'nonce-…' data:`、`connect-src 'none'`、`img-src data:`、`frame-src/form-action/base-uri 'none'`）→ 插件**无法发起任何网络请求**（含内网），数据只能由宿主取好后经桥传入；入口模块经 data: URL 在框内 `import()`（自包含、禁止 import 外部模块），源码永不进入宿主 JS 作用域；宿主 ↔ 插件只交换结构化 postMessage（sourceWindow 校验 + `aio-*` 标识）。运行时 ABI：入口默认导出 `render(props, ctx)`（详见 widget-sdk README）。
- **影响**：启用插件按 manifest.type 动态注册进 components map / 组件选择器 / 配置表单（J8"新增组件不改核心"）；动作按 `permissions.actions` 白名单放行、未声明即拒绝；入口源码以 JSON 下发（不作 JS 资源伺服）。数据桥（capabilities.data）与凭证/权限执行、动作执行通道在 Q5d 随权限执行一并落地。
- **被否备选**：Web Component + Shadow DOM（JS 同 realm，无隔离）；ShadowRealm（未标准化）；动态 import 进宿主 realm（等同 eval）；iframe 加 allow-same-origin（插件可摸宿主同源资源）；服务端执行插件代码（K7 明确最后考虑，最大攻击面）。

## D26 · 插件数据桥与权限执行语义（widgets.data / credentialKinds / 数据源白名单）

- **状态**：已决
- **背景**：Q5d-2 落地 FR-W7 权限白名单**执行**与 FR-W3 数据桥。D25 已定沙箱（插件零网络），但"数据如何进沙箱、权限在哪个点把关"未冻结：`capabilities.data` 路由、`permissions.apis`/`credentialKinds` 的语义与执行点必须先定，否则插件数据面无法实现。
- **决策**：① 插件数据一律走宿主统一数据通道（`POST /api/widgets/data`，`type` = 插件 type），服务端按 manifest 路由到宿主 connector —— v1 数据源仅 `http-connector` / `none`（插件 config 键沿用 http connector 约定：url/apiToken/authHeader/headers/method/body）；② `permissions.apis` 须含 `"widgets.data"` 才可取数（可访问 API = 显式白名单，未声明即拒绝）；③ `permissions.credentialKinds` 按凭证件 `kind` 逐个把关（SecretRef 解密**之前**校验，未声明的 kind → 403），凭证明文只在服务端 connector 内解密（SEC3 不变）；④ 禁用/未安装插件按"未知类型"400；权限拒绝统一 403 + 明确原因。
- **影响**：PluginFrame 经 `usePluginData` 取数并把 data 经桥传入沙箱，取数报错在宿主侧可见横幅；workspace 数据源与动作执行通道留待后续（Q5d-3：动作按 `permissions.actions` 白名单 + 服务端执行 + 审计）。
- **被否备选**：插件在沙箱内自取数据（违背 K7"宿主统一数据通道"，CSP 已禁网）；宿主把凭证明文塞进沙箱（破坏 SEC3）；按插件整体放行凭证（违背最小权限，须按 kind 白名单）；数据源映射做成可插拔插件（过度设计，v1 固定两类）。

## D27 · 插件动作执行通道：服务端固定 registry + 白名单 + 审计日志

- **状态**：已决
- **背景**：Q5d-3 收口 FR-I5"服务端执行 + 审计"与 FR-W7 动作白名单的执行语义。D25/D26 已定沙箱与数据/凭证白名单，但桥送来的 `action(name, params)` 由谁执行、执行面多大、审计如何落必须先冻结——否则"执行插件动作"极易滑向执行任意代码。
- **决策**：① 动作名须在 `permissions.actions` 白名单内（宿主桥先拒、服务端复核）；② 执行体是**服务端固定 registry**（v1 = `todo.create` / `todo.toggle` / `feed.markRead`，均为既有写操作的 zod 校验封装），**不执行任何插件代码/表达式**；未声明 403、未知动作 400、参数非法 400、禁用插件 400；③ 审计 = 每次执行一条结构化日志（NFR1：who / plugin / action，**参数不入日志**——用户内容与密钥不进日志是保密基线），审计表随公网化 SEC6 落地；④ 执行后按动作主题（todo/rss）失效数据缓存 + SSE 广播（同 FR-I6）。
- **影响**：PluginFrame 桥接动作 → `POST /api/plugins/:id/actions`；插件可安全驱动 Workspace 写操作（如"一键建任务"），与 D24 ABI 的 actions 白名单闭环；至此 Q5（代码级插件）Q5a–Q5d 全部完成。
- **被否备选**：在沙箱/宿主 realm 执行插件传来的代码（等同 RCE，直接否决）；动作名自由映射到任意 REST（绕过白名单语义）；参数完整入日志做审计（违背日志保密基线）；插件自带服务端逻辑（K7 明确最后考虑）。

## D28 · 组件自配置写回：gridstack 节点 props + 宿主 requestSave 服务

- **状态**：已决
- **背景**：Q6b 看板组件需要"组件内选看板"（属组件配置，非临时状态）且要随布局持久化。布局 JSON 保存由宿主（Board）按防抖触发，组件自身无法触达；gridstack 的 `useWidgetSerializer` 合并发生在 save 时，但改状态不会触发 save。需要统一一条"组件改写自身配置"的通路。
- **决策**：组件内配置变更 = `grid.update(node.el, { props })` 写回节点（宿主据 updateCB 重渲染）+ 调用宿主注入的 `requestSave()`（WidgetEditContext 新增的宿主服务，指向 Board 的防抖保存，FR-P4）。配置弹窗（FR-W4）与组件内写回共用同一 props 通路；Workspace 数据仍走 REST/SSE，不混入 props。
- **影响**：任意组件可安全地把"视图选择"沉淀为配置（如看板选择）；`WidgetEditContext` 从"编辑态开关"演进为**宿主服务**上下文（editMode / onConfigure / requestSave）。实现注意：React 的 setState updater 会在渲染期重放，**事件对象属性（`e.currentTarget`）不得在 updater 内读取**（否则 null 崩溃）——已在 Q6b 踩坑并修复。
- **被否备选**：`useWidgetSerializer`（不触发保存，需配合 requestSave，徒增一层）；仅配置弹窗可选看板（组件内切换体验差）；组件直连布局保存 API（破坏"宿主持有布局"边界）。

## D29 · 卡片拖拽 vs 布局拖拽：模式互斥 + 「移动到」备选（Kanban Q6c）

- **状态**：已决
- **背景**：Q6c 落地 06 §1"嵌套拖拽手势专门设计"。gridstack 在组件项上监听指针拖拽做布局移动，卡片拖拽与之在同一批事件上直接冲突（K8 记录的 Kanban 主要难点）。
- **决策**：**模式互斥**——编辑模式下拖动 = 调整布局，卡片 `draggable=false` 并显示提示；浏览模式（gridstack 本就 `disableDrag`）卡片以 **HTML5 DnD** 拖放（卡片 dragstart → 目标列 drop），与 gridstack 的鼠标拖拽路径完全解耦。移动语义 = 落目标列**末尾**（sortOrder = 列内最大 + 1）；拖拽与「移动到」选择器共用同一 `moveCardTo` 通路。**触控/键盘可达备选** = 卡片编辑器的「移动到」选择器（HTML5 DnD 不支持触屏；移动端 D10 仅浏览 + 组件内操作，天然是选择器路径）。
- **影响**：桌面浏览态可拖卡、编辑态专注布局；移动端/键盘用户无功能损失。列内任意位置插入（拖到两张卡之间）留待后续。
- **被否备选**：全局 `dragHandle` 限定布局拖拽（所有组件布局手感退化，且把手仍嵌套冲突）；编辑模式内抑制 gridstack 指针（hack 事件链，布局编辑可靠性受损）；鼠标事件自制拖拽（与 gridstack 同源事件链仍冲突、触屏同样不可用）；仅选择器不提供拖拽（桌面效率差，违背"拖拽手势"诉求）。

## D30 · 邮件组件技术边界：IMAP 只读聚合 + 沙箱渲染（Q7）

- **状态**：已决（其中 Gmail API 专项是否需要 = 待用户拍板，见 07 待用户确认，不影响 IMAP 版）
- **背景**：Q7（06 §1"邮件组件（只读）"，01 FR-E3/§2.3 排后项）进入实施，需定协议面、正文渲染安全（不可信 HTML）、写操作边界与目标可达性基线。06 待定 #3"是否需要 Gmail API 专项"的决策时机即"邮件组件排期时"。
- **决策**：① 协议面 = **IMAP**（imapflow + mailparser），多账号聚合、逐账号错误隔离、列表 60s TTL 缓存；**Gmail API/OAuth 专项不纳入本期**（Gmail 可走 IMAP + 应用专用密码），是否另立专项待用户拍板；② **只读**（D3）：不提供发送/删除/移动/SEEN 回写端点；③ 正文为不可信 HTML —— 渲染采用**沙箱 iframe**（D25 同款工具：deny-all + CSP `script-src 'none'`、远程图片默认禁），服务端仅做体积截断（text 100KB / html 200KB），不引入消毒库；④ IMAP 目标过 SEC4 SSRF 基线（内网默认拒 + `ALLOW_PRIVATE_OUTBOUND` 逃生阀，同 HTTP）；密码只存凭证库引用（SEC3），仅连接期解密入内存；⑤ 服务层抽象 `MailClient`（单测注入假客户端），imapflow 适配器薄封装。
- **影响**：Q7a（账号模型 + 聚合服务 + REST）落地；Q7b（邮件组件 UI）沿用本决策（沙箱正文渲染）。
- **被否备选**：Gmail API/OAuth 专项（范围外，待拍板）；服务端 HTML 消毒库（沙箱已完全禁脚本，消毒库徒增解析面）；落库邮件索引（个人规模活取 + 缓存足够，索引同步成本高）；发送/标记等写操作（违背 D3 只读边界）。

## D31 · 破坏性操作二次确认（ConfirmAction 约定）

- **状态**：已决
- **背景**：第 15 轮测试事故——未限定范围的自动化点击命中「删除此页」，直接删除了活动看板布局。暴露出产品面缺陷：删除页面/列/卡片/账号/卸载插件等破坏性操作**无确认、误触即丢数据**。
- **决策**：所有破坏性操作统一走 `ConfirmAction` 组件（触发按钮 + 确认弹窗「确认」/「取消」）：删除页面、删除看板列（提示连带卡片数）、删除卡片、删除邮件账号、卸载插件；确认文案**顺带说明数据边界**（删页面/布局不删 Workspace 业务数据，01 §1.3）。布局编辑内的组件移除（编辑模式拖拽/删除最后）属常规编辑动作，不加确认（避免编辑流程被弹窗打断）。
- **影响**：误触不再丢数据；自动化脚本对破坏性操作的点击变为「触发 → 确认」两步（verify-m1/ mail / pl6 已同步）。
- **被否备选**：`window.confirm`（阻塞式、样式不可控、自动化不友好）；仅对删除页面加确认（不一致，列/卡/账号同样不可逆）；撤销栈（实现成本高，个人规模收益低，后续可再议）。

## D32 · OpenCode 组件：直接 HTTP 薄封装 + 版本探测容错（Q8）

- **状态**：已决
- **背景**：Q8（06 §1"OpenCode 组件：会话列表/状态/耗时；API 版本探测"，01 FR-E4）实施。06 备注"薄封装官方 SDK；experimental API 风险"——SDK 本身即 experimental API 的又一层变动面，且我们只用传输层。
- **决策**：① **直接 HTTP 薄封装** opencode server API（`/app` 版本探测 + `/session` 会话列表），不引入官方 SDK 依赖——绑定面最小化，响应形状做兼容归一（`time.{created,updated}` 与扁平字段均接受）；② **版本探测 + 容错**：API 不可达/形状不符不抛错，返回 `probe{ok,error}` 由组件显式提示（"实验性接口可能已变更"），绝不空白；③ 会话耗时 = updatedAt − createdAt；④ 目标为本机/内网 opencode server（服务聚合核心场景）→ 走 allowPrivate 通道（同 app-launcher/iframe-embed，D22 同族）；令牌经凭证库注入 Bearer（SEC3）；⑤ 手动刷新强制回源（跳过客户端 staleTime 与服务端 TTL），尊重数据通道 5s 最小间隔限流。
- **影响**：会话监控可用且对 experimental API 漂移免疫（显式降级）；若日后官方 SDK 稳定可平滑替换传输层。
- **被否备选**：引入官方 SDK（多一层 experimental 变动面、体积大）；仅缓存不探测（API 漂移时静默空白）；写操作（发消息/中止会话）——超出 06"会话列表/状态/耗时"范围，未纳入。

## D33 · 待定项定论回写（Todo 数据模型 / RSS 源管理形态）

- **状态**：已决
- **背景**：06 §3 待定 #1（Todo 数据模型细节，期望决策时机 M2 开发期）与 #2（RSS 源管理形态，M3 开发期）的决策时机已过、实现即定论，按维护约定回写结案。
- **决策**：① **Todo 模型** = `todo` 表（`list` 清单名 / `title` / `done` / `sortOrder`，D21 `user_id` 归属）；组件配置选择清单（inbox/work/life）与过滤（open/all），**数据归 Workspace、视图过滤在组件**（01 §1.3 数据/视图分离）；② **RSS 源管理 = 组件内配置**（rss 组件内订阅/退订），不做全局管理页。
- **影响**：06 §3 关闭 #1/#2；后续如需任务归档/富文本或全站 RSS 源共享，另立需求再议。
- **被否备选**：Todo 独立多表（清单/标签拆表，个人规模过度设计）；全局 RSS 源管理页（当前仅 rss 组件消费，页级管理过重；组件内配置即改即用）。

## D34 · D31 边界细化：清单内单项删除同样二次确认

- **状态**：已决
- **背景**：D31 落地后审计发现两类"清单内 ×"未过确认——Todo 任务删除、RSS 源退订，与同形态的看板卡片删除（已确认）不一致；D31 的被否备选已否"仅部分删除加确认（不一致）"。
- **决策**：**凡不可逆的删除/退订/卸载一律二次确认**（含清单内单项）；**唯一豁免 = 布局编辑内的组件移除**（拖拽移除/删除最后，属常规编辑动作，弹窗会打断编辑流）。低成本可逆（如退订可重订）也在确认范围内——文案顺带说明可恢复性，而非据此豁免。`ConfirmAction` 弹窗按需挂载（关闭态 Mantine Modal 留空 root，逐行实例会膨胀 DOM）。
- **影响**：Todo 任务删除、RSS 源退订接入确认（弹窗点名目标）；自动化脚本对这两类操作改为「触发 → 确认」两步。
- **被否备选**：按"可恢复性"豁免清单删除（判定含糊、退订/删任务体验不一致）；撤销栈（D31 已否，成本高）；仅悬停显示 ×（触屏不可用，且不解决误触）。

## D35 · 自定义 API 模板升级：受限 JSX（Homarr 模式）

- **状态**：已决（用户拍板，2026-09-29）
- **背景**：Q10（06 待定 #5：受限 JS/JSX 模板的安全边界）。调研 Homarr 的 Custom Widgets：其"Custom JSX"并非执行任意 JS，而是**组件白名单 + 安全数据绑定**的声明式模板（9 种展示预设 + 白名单 Mantine 组件；事件处理器/危险标签剥离、`eval`/`import`/`fetch` 等标识符字符串级拒绝、href 白名单）。我们与 Homarr 同为 Mantine v9，此模式可直接复用其组件观感。
- **决策**：模板升级采用**受限 JSX（数据非代码）**：① 仅白名单组件（Mantine v9 布局/排版/数据展示/图表）；② 绑定面 = `data` + 安全子集（String/Number/Boolean、Math 子集、JSON.stringify、Array/Object 无害方法）；③ 拒绝含 `eval`/`Function`/`import`/`require`/`globalThis`/`window`/`document`/`fetch` 的模板；④ 渲染期剥离事件处理器、`dangerouslySetInnerHTML`、script/iframe/object/embed/form/style/link/meta/base；href 仅 `https://`、相对路径、`#`；⑤ 恶意样例回归测试守护。三层兜底：声明式预设 → 受限 JSX → Raw JSON。
- **影响**：Q10 实施以此为边界；未来模板导入/共享按不可信输入对待（该模型已覆盖）。
- **被否备选**：沙箱 iframe 跑任意 JS（隔离更强但视觉孤岛、与宿主组件脱节；保留为未来"高级逃生舱"）；纯表达式 DSL（表达力不足）；宿主 realm 执行 JS（无隔离，否决）。

## D36 · 服务器监控：打通第三方服务（Glances 优先，只做连接与展示）

- **状态**：已决（用户拍板，2026-09-29）
- **背景**：Q9（06 待定 #4：监控数据来源选型）。原三选项（后端直采/node-exporter/自研 agent）都隐含"我们负责采集"；用户定位是**打通与展示**——监控由既有服务承担。
- **决策**：定义**监控源适配器契约**（`fetch → 归一化指标 { cpu, mem, disk[], load, uptime, extras }`），v1 实现 **Glances 适配器**（`glances -w` REST API `/api/4/*`），后续按需增补（node-exporter / Netdata / Uptime Kuma…同一 widget 多 source）。配置 = URL + 可选认证（凭证库引用，SEC3）；目标为内网服务（同 app-launcher/OpenCode 族，D22 allowPrivate 通道）。**不自建采集、不落时序库**（历史曲线依赖来源方，或后续轻量采样表再议）。
- **影响**：Q9 实施以此为架构；部署文档需注明"先自行运行 Glances 等数据源"。
- **被否备选**：后端直采（自建采集面，违背"只做打通"定位）；自研 agent（工作量/安全面最大，否决）；绑定 Prometheus 全家桶（部署复杂度超出个人工作台）。

## D37 · Gmail API 专项纳入（OAuth 授权流，只读）

- **状态**：已决（用户拍板，2026-09-29）
- **背景**：06 待定 #3（邮件是否需要 Gmail API 专项）。用户确认**需要**。
- **决策**：邮件组件增加 **Gmail 数据源**：OAuth 授权流（用户自备 Google Cloud client_id/secret，redirect 端点 `/api/mail/gmail/callback`；refresh_token 存凭证库）；`messages.list/get` **只读**（D3 边界不变）→ 归一为现有 `MailMessageSummary/Full` 与 IMAP 账号同列表聚合（逐账号错误隔离复用）。token 只在服务端、不入日志。
- **影响**：拆分 Q-G1（OAuth 绑定）/ Q-G2（拉取映射）/ Q-G3（文档 + 验收）；D30 的"Gmail 专项不纳入本期"就此更新。
- **被否备选**：应用专用密码走 IMAP（即现状，不算专项）；Gmail 服务账号（面向 Workspace 域，不适用个人账号）。

## D38 · 编辑态组件内容惰性（inert）

- **状态**：已决（用户反馈，2026-09-29）
- **背景**：用户反馈"编辑布局时不允许修改看板/Todo 等可编辑卡片"。D29 已定拖拽的模式互斥，但组件内操作（勾选/输入/加卡/点击）仍可在编辑态触发，既易误操作又与布局拖拽争抢手势。
- **决策**：编辑态下组件内容整体 **`inert` + `pointer-events:none`**（宿主「配置」入口在外层不受影响）；浏览态完全恢复。与 D29 合成完整语义：**编辑 = 只动布局；浏览 = 组件内操作**。
- **影响**：旅程脚本（verify-j4/j6/kan/mail、Playwright J4）改为浏览态执行卡片/链接操作；自动化点击语义改真实鼠标（命中测试才走 inert）。
- **被否备选**：逐组件手写禁用态（侵入所有组件、易漏）；仅禁止拖拽相关手势（误操作仍在）。

---

## D39 · 样式定制契约（令牌 + 语义类 + 用户样式表）与移动端单列

- **状态**：已决（用户要求 + 视觉审计 P0-1/P0-2，2026-09-30）
- **背景**：用户明确要求"允许用户自定义所有的 CSS"，且需高质量、命名清晰、可复用、可替代的 CSS。视觉审计另发现组件卡片无容器（P0-1）、≤480px 双列挤压标题折行破碎（P0-2，与 D12 断点 480→2 列相抵）。
- **决策**：
  1. **三层定制契约**（详见 `docs/design-audit/02-custom-css.md`）：① 全部设计决策收敛为 `apps/web/src/styles/tokens.css` 的 `--wb-*` 令牌；② 组件结构用稳定 `.wb-*` 语义类名（BEM），类名即公共 API，**禁止内联 style**；③ 用户样式写 `./data/custom.css`，与 Mantine 令牌桥合并经 `/custom.css` 于 **index.html 末尾**下发（段内后写覆盖前写，用户永远赢，全程无 `!important`）。
  2. **Mantine 桥接不走 `cssVariablesResolver`**：实测其输出与 Mantine 默认值并入同一规则（默认在后覆盖我们），故桥接表由服务端合成下发（`apps/server/src/styles-bridge.ts`）。
  3. **移动端单列**：gridstack 断点 `{ w: 480, c: 2 }` → `{ w: 480, c: 1 }`（P0-2 修复，修正 D12 的 480→2 列）。
- **影响**：主题改造只需覆盖令牌；`verify-dark` 3 面 AA 保持 0 失败；新增 `/custom.css` 契约测试（bridge 在前、用户在后）。唯一 `!important` 保留给 NFR2 触控下限（可达性优先）。
- **被否备选**：`!important` 覆盖 Mantine 变量（与用户抢优先级，违背定制要求）；纯内联样式主题（不可覆盖）；仅提供主题切换（覆盖面不足"所有 CSS"）。

---

## D40 · Workspace 标签体系与数据管理面

- **状态**：已决（用户反馈④，2026-09-30）
- **背景**：RSS 订阅源以「底部药丸行」就地管理被指不合适；用户明确：Todo/RSS 这类数据都是 **Workspace 级数据**，应有一个统一管理处，可给数据打**多个标签**，Dashboard 里的 Todo/RSS 卡片只需「选择当前卡片要展示的标签」。
- **决策**：
  1. **标签模型**：`tag`（userId 归属 D21 + 名称 + 可选色）+ **多态关联 `tag_target`**（tagId + targetType + targetId + userId，复合主键）。targetType 白名单 `["todo", "feed"]`（zod 枚举，扩展=加枚举值，不再迁移）；标签删除 FK 级联删关联；**目标实体删除时应用层清理关联**（SQLite 无多态外键，删除路径统一走 deleteTargetLinks）。
  2. **管理面**：头部「数据管理」入口 → 弹窗三页签 **Todo / 信息源 / 标签**（增改删 + 打标签 + 退订带确认）；RSS 底部药丸行迁入此处后移除。
  3. **组件筛选**：Todo/RSS 组件「筛选」勾选标签 → **写回组件配置 props.tagIds**（D28 requestSave 同款，与看板选看板一致）；数据查询按 tagIds 过滤（connector/服务端过滤，非前端过滤）。
  4. **兼容**：Todo `list`（inbox 等）保留不动，标签是叠加维度；不破坏既有数据、脚本与概念模型（§1.3）。
- **影响**：FR-D1~D4 入 01-requirements §2.6；新表迁移由 drizzle-kit 生成（D18）；RSS/Todo 连接器新增 tagIds 过滤参数（Q22b-2 兑现）。
- **被否备选**：每个实体一张显式联结表（扩展需迁移，收益仅 FK）；用 Todo `list` 充当标签（单值、两实体语义不一）；订阅源继续在组件内管理（破坏数据/视图分离）。

---

## D41 · D10 边界澄清：数据管理属数据操作，移动端开放

- **状态**：已决（用户拍板方案 A，2026-09-30，ISS-7）
- **背景**：ISS-7 指出「数据管理」入口被 `isDesktop` 限定 —— D10 允许移动端「浏览 + 组件内操作」，组件内标签筛选可点，但创建标签/管理数据必须回桌面端，能力断链。
- **决策**：D10 的「禁止编辑」指**布局编辑**；Workspace 数据管理（任务/订阅源/标签的增改删与打标签）属**数据操作**，移动端**开放**「数据管理」入口。**布局编辑与插件管理**仍桌面专属（D10 原义不变）。
- **影响**：头部按钮可见性矩阵调整（编辑布局/插件管理=桌面，数据管理/退出=全端）；触控尺寸由 NFR2 全局规则覆盖；verify-j3 补移动端断言。
- **被否备选**：维持桌面专属（能力断链，与 FR-D2「Workspace 级统一管理」冲突）。

---

## D42 · 数据源全量迁入「数据源管理」：命名连接模型

- **状态**：已决（用户拍板"一并"，2026-09-30，Q26）
- **背景**：邮箱/监控源/OpenCode 连接/自定义 API 凭证均属"数据源"，此前分散在各组件配置里（url+密钥随组件走），管理不集中、凭证语义不统一。
- **决策**：
  1. **命名连接**：新增 `data_source` 表（`kind ∈ {monitor, opencode, http}` + name + config_json，user_id 归属 D21；同用户同 kind 唯一名）。**邮箱沿用 `mail_account`**（已具备 IMAP/OAuth/凭证语义），仅管理 UI 迁入统一门户。
  2. **凭证不入 config**：secret 字段经凭证库（SEC3，`propsWithSecretRefs` 同款流程），config 只存引用。
  3. **组件引用 + 内联回落**：monitor/opencode 组件配置可选 `sourceId`（解析出 url/auth）；未引用时沿用内联 url/字段（向后兼容，既有布局零迁移）。自定义 API 组件的 `sourceId` 提供**认证**（token/头名），`url` 仍由组件配置（端点各异）。
  4. **管理门户**：数据源管理页签 = 任务 / 信息源 / 看板 / 邮箱 / **数据连接** / 标签。
- **影响**：FR-D2 管理面扩展；ConfigForm 支持动态选项（供 `sourceId`/`boardId` 下拉）；widget 端配置解析走连接优先。
- **被否备选**：mail_account 并入 data_source（迁移风险大、OAuth 语义特化）；组件配置强制改为引用（破坏既有布局）。

---

## D43 · Todo 任务归属 = 卡片名称（废除「清单」字段）

- **状态**：已决（用户拍板三点，2026-09-30，Q28）
- **背景**：「清单」（收件箱/工作/生活）是独立维护的第二套分类，用户要再管理一层、且与卡片脱节；数据源管理里任务扁平排列（badge 样式）难区分归属。
- **决策**：
  1. **归属维度**：任务不再有「清单」字段；归属 = **Dashboard 上 Todo 卡片的名称**（组件配置「名称」文本字段）。组件新建任务自动归入该名称；两个 Todo 卡片**不允许重名**（配置保存时校验，重名拒绝）。
  2. **数据边界**：删除 Dashboard 上的 Todo 卡片 → **任务数据保留**（可在数据源管理查看）；**删除分组才真删**——数据源管理按卡片名称分组，分组「删除」= 真删该组全部任务（二次确认 D31/D34）。
  3. **兼容**：`todo.list` 列语义改「卡片名称」（列名不迁移，旧值 inbox/work/life 直接成为组名）；组件 props 读取 `name ?? list`（旧布局零迁移）。
- **影响**：FR-D2 管理面任务页签改按名称分组；组件配置「清单」下拉 → 「名称」文本（必填）；删卡片/删页面确认文案注明数据保留。
- **被否备选**：实例 ID 作组名（分组名不稳定、管理面难认）；同名共享池（用户明确不允许重名）。

---

## 命名约定（非编号决策，已确认）

- 顶层概念 **Workspace（空间/工作台）**，其下 **Dashboard（页面）**，再下 **Widget（组件）**；文档统一用 Workspace 作顶层。
- 概念模型详见 [01-requirements.md](01-requirements.md) §1.3。

## D44 · Todo 归档项语义（组件不可见，仅管理面）

- **日期**：2026-09-30（Q29b，用户反馈⑩ Todo 重构；补录）
- **决策**：Todo 项增加 `archived` 标记；**组件一律不显示归档项**（含「全部」档），仅数据源管理「任务」页签可见并可恢复/删除；API `includeArchived=1` 仅管理面使用。
- **后果**：「显示」三档（未完成/已完成/全部）均不含归档；归档 ≠ 删除（数据保留，FR-D4 边界不变）。

## D45 · 图标体系（图标库 + 自定义图标库）

- **日期**：2026-10-01（Q38，用户反馈⑪三.1）
- **背景**：已接入服务此前用自绘 SVG，辨识度差；要求引入图标库并对已接入服务用**官方图标**，另支持自定义图标库。
- **决策**：
  1. **内置图标库 = vendored 品牌 SVG 子集**（`apps/web/src/icons/brand/`，随包分发、零外呼）：来源限 simple-icons（CC0）与 homarr-labs/dashboard-icons（集合 MIT，商标归各自所有者），`SOURCES.md` 逐个登记来源与许可；黑色单色图标改 `fill="currentColor"` 适配暗色主题；vendor 期内联 `<style>` 类填充为元素属性（防全局样式泄漏）、剥 `<title>`（防文本污染）。
  2. **服务用官方图标不自绘**：`ServiceIcon` 组件 + `WidgetManifest.icon`（字符串=内置名或 URL）；数据连接画廊、组件选择器卡片已接线。通用概念（http/todo/kanban 等）不属「服务」，保留既有自绘/图标名。
  3. **自定义图标库**（Q38b）：用户上传 SVG/PNG 入 `icon` 表 + `data/icons/` 文件存储，数据源管理维护（增删/引用），配置侧以 URL/`custom:<id>` 引用（SEC3 不涉及密钥；SVG 上传须服务端净化，防 script 注入）。
- **后果**：新增服务接入必须同步登记官方图标与来源；图标变更走 `SOURCES.md` 留痕。

## D46 · 第三方服务接入形态（Immich / Navidrome / Portainer / Mihomo·metacubexd）

- **日期**：2026-10-01（Q39，用户反馈⑪三.2「尝试接入更多数据源」）
- **决策**：v1 = **连接 + 概览展示**（D36 同族「只做连接与展示」）：
  1. 数据连接新增 `immich` / `navidrome` / `portainer` / `mihomo` 四类（**metacubexd 为 Mihomo 的 Web 前端，归 `mihomo` 类**，secret = external-controller 密钥）；认证字段与各服务 API 对齐（immich/portainer = API Key，navidrome = Subsonic u/p（salt+token md5），mihomo = Bearer secret），secret 一律入凭证库（SEC3）；目标为内网服务 → allowPrivate 通道（monitor 同族）。
  2. 各服务适配器归一 `ServiceOverview { probe, version?, stats[] }`（探活 + 版本 + 关键计数；接口缺失 best-effort 省略）；「服务概览」组件消费（选连接 → 徽标 + 版本 + 计数 + 详情原始 JSON）。
  3. **深度组件属二期另立需求**（Immich 照片墙、Navidrome 播放、Portainer 容器操作、Mihomo 代理切换等不在本项）。
- **后果**：新服务接入按「连接 kind + 适配器 + ServiceOverview 归一」模式扩展；品牌图标按 D45 登记（SOURCES.md）。
- **后续**：v1 的 `stats[]` 贫血契约被用户批评为 demo 级（Q39 四服务指标），契约演进见 **D48**；指标质量规范见 **D47**。

## D49 · gridstack React wrapper 竞态补丁（拖动中卡片内容消失）

- **日期**：2026-10-01（Q43，用户反馈⑫一.3「拖动卡片时，偶发卡片会消失，只有右下角的调整大小的箭头还存在」）
- **根因**（红-绿验证实锤）：gridstack@14.0.0 React wrapper（`dist/react/`）两处竞态同症——① `syntheticItems` 在**渲染期** `Utils.findInGrid` 查节点，拖动中节点短暂离开引擎（`dropout→_leave→removeNode` 窗口）时查不到 → `return null` → **portal 整体卸载**；② `GridStackItem` 容器 effect 查不到 `.grid-stack-item-content`（`node.el` 被换成 drag placeholder）时 `setContainer(null)` 同样卸载。卸载后若无后续重算**永不自愈**（故"偶发"且持久）。症状与上游 #2976 同族（该修复只覆盖 sidebar 拖入路径）。
- **决策**：`pnpm patch gridstack@14.0.0` 打两处守卫（last-known-node 回退 + keep-previous-container），`patches/gridstack@14.0.0.patch` 入库 + `patchedDependencies`（pnpm-workspace.yaml，Docker 构建自动应用）。**否决**：升级（14.0.0 即最新版）、切换选型（D12 冻结）、watchdog 自愈（治标）。
- **验证**：`verify-gdrag.mjs` —— 25 轮多路径拖拽压测（空白落点/碰撞交换/越上缘/拖远放回原位）+ **确定性竞态用例**（monkey-patch `findInGrid` 模拟竞态窗口 → 断言内容不卸载）。**红-绿**：还原补丁行为复跑 → 5 卡内容全部消失（`during:[0,0,0,0,0]`）→ 用例有效；恢复补丁 → 28/28 绿。
- **附带教训**：verify 脚本共享同一工作台状态，**新脚本必须收尾恢复标准 seed**（否则污染不自播种的后续脚本：verify-gdrag 曾致 verify-j3「信息流不可见」误报）。

## D47 · 组件/接入质量门禁（指标设计与完成定义）

- **日期**：2026-10-01（Q40，用户反馈⑫二.1「没有从用户角度考虑用户希望看到什么指标……完全是作为一个 demo 来做的」，用户要求建立自我约束）
- **背景**：Q39 四服务指标推导方向反了（"API 给什么展示什么"），且把"我没取到"写成"服务未提供"、只 mock 不真机验证。用户拍板建立自我约束，采用"三层全要"方案。
- **决策**（三层机制，全部落地）：
  1. **方法规范** `docs/feature-plan/08-widget-quality.md`：推导顺序 = 用户问题清单（3–5 条）→ 对照物（官方 UI + 成熟 dashboard）→ 指标映射表（问题/指标/来源/降级四列）→ API 落实（多接口聚合 + 多版本回落 + 权限模型意识）→ 真机验证；降级文案必须"原因 + 怎么修"，**禁止"服务未提供"式甩锅**。
  2. **硬门禁**：AGENTS.md「组件/接入质量门禁」+ loop-prompt 第 7 步引用 —— 完成定义 = 08 §5 DoD 清单勾全（含真机验证或显式"待真机验证"标注），自检结果写入 07 当轮记录。
  3. **流程 skill** `.opencode/skills/service-integration/`：把接入全流程（调研→用户问题→指标→契约→降级→真机）编码为可自动带入的约束载体。
- **配套纪律**：真机验证凭证只落 `.opencode/.env.verify`（`.env.*` 已 gitignore，不入库/不入日志/不进前端），用后提醒用户轮换；调研证据入 `docs/feature-plan/research/`。
- **后果**：凡组件/接入/指标改动必须过 DoD；"测试全绿"不再是唯一完成标准。

## D48 · ServiceOverview 契约演进：结构化卡片 + 迷你图表

- **日期**：2026-10-01（Q44，用户反馈⑫二.1，用户拍板形态="结构化+迷你图表"）
- **决策**：`ServiceOverview.stats: [{label,value}]` 升级为结构化模型——**主指标（1）/ 次指标（2–4）/ 状态徽标 / 清单（异常·最近·正在发生）/ 迷你趋势序列**；数字带单位与语义、相对时间悬浮绝对、异常清单置顶高亮、全健康给绿态不留空（08 §3）。
- **趋势数据来源**：**客户端累积轮询序列**（不改 schema、不动 D18）——服务端仅回"本次采样点"，前端按轮询积累画迷你图；速率类（mihomo 上/下行）用累计量差分计算（真机实测 `/traffic` 流式经反代不可用）。
- **兼容**：旧 `stats[]` 归一逻辑随各服务子项（Q45–Q48）迁移，归一函数契约测试覆盖降级分支；widget-sdk 契约变更按 D7「契约先行」先改契约与文档再改组件。
- **追认（2026-10-01）**：趋势数据来源「客户端累积轮询 + 累计量差分」经用户追认为正式口径。

## D50 · FR-X3 服务深度组件立项口径：只读优先

- **日期**：2026-10-01（用户拍板"立项，只读优先（推荐）"）
- **决策**：深度组件**立项**，但按读写分界拆两批：
  1. **只读深度（本次立项，【必须】）**：Immich 照片墙、Navidrome 专辑/正在播放展示、Portainer 容器清单/状态/日志尾部、Mihomo 节点列表/延迟/订阅源详情。媒体资源（缩略图/封面）一律**服务端代取**（凭证不进前端，SEC3/SEC4 边界不变）。
  2. **写操作类（【待拍板】，另行立项）**：Navidrome 播放遥控、Portainer 容器启停/重启、Mihomo 策略组切换 —— 均突破 D36"只做连接与展示"边界，涉及生产容器/代理出口变更，各自的风险边界与确认机制（D31 族）需用户逐项拍板后才实施。
- **流程约束**：每个深度组件按 D47 门禁走（用户问题 → 对照 → 指标/内容映射 → API → 真机验证）。
- **二期收口（D51）**：写操作类三项经用户"逐项拍板"立项，安全边界见 **D51**。

## D51 · 写操作类深度组件立项（三项，各带安全边界）

- **日期**：2026-10-01（用户"逐项拍板"；D50 二期收口）
- **决策**：三项写操作深度组件立项，**各带安全边界**：
  1. **Navidrome 播放遥控**（Q55）：play/pause/next/prev；作用于服务器**当前播放会话**（多设备同时收听会互相干扰 —— 组件内注明"单设备场景"）；播放控制属低风险高频操作，**免逐次确认**；操作经专属 REST + 审计日志。
  2. **Portainer 容器重启**（Q56）：**仅 restart**（不含 start/stop/delete/pause —— 破坏面最小）；**容器白名单**（组件配置勾选允许重启的容器，缺省空=不允许任何）；**D31 二次确认**（显示容器名）+ 审计日志。
  3. **Mihomo 策略组切换**（Q57）：切换**前确认**（显示当前节点 → 目标节点）+ 审计日志；仅切换策略组选择，不改配置文件。
- **通用约束**：写操作一律专属 REST 端点 + 服务端审计日志（who/when/what，参数入日志仅限操作对象标识，**凭证永不入日志**）；前端写操作按钮与只读展示视觉区隔；`capabilities.actions` 声明（FR-I5）。

## D52 · 视觉规范 v2：A 克制精致 + 玻璃光感（双主题 + 按钮 icon 化）

- **日期**：2026-10-01（Q58 样张圈定 + Q59 落盘；用户拍板："A 克制精致"主方向 / 先样张 / 含微交互与浅色主题 / 基础层先行）
- **决策**：
  1. **风格基调**：A 克制精致（Linear/Vercel 工具感）为骨 + **玻璃光感**为氛围（用户从 4 张样张选定 02：半透明玻璃卡 + 三色背景光晕）；tinted slate 四级表面、多层阴影、Inter Variable 品牌字体（OFL 许可随包 vendored）、展示级数字排版、动效令牌（120/180/280ms 统一缓动）。
  2. **双主题**：`:root` 深色默认 + `[data-theme="light"]` 浅色变量组（Q63 接线 + verify-dark AA 双主题守护）。
  3. **按钮 icon 化**（用户要求）：文字按钮尽量替换为图标 + tooltip + aria-label；verify 脚本选择器同步 text→aria-label（Q65）。
  4. **契约不变（D39）**：视觉只经 `--wb-*` 令牌与 `.wb-*` 语义类表达，`./data/custom.css` 覆盖能力保持；样张管线 `capture-style-variants.mjs` 留作后续风格迭代工具。
- **落地**：Q60–Q65 六批（基础层→组件层→内容层→浅色→微交互→icon 化），每批前后截图 + AA + 全量回归。

## D53 · 提交即推送（部分取代 D22 的 `git push` 禁止项）

- **日期**：2026-10-01（用户主动要求「添加一个行为准则：从现在开始，提交后自动推送」）
- **背景**：D22 授权自主迭代 loop 时把 `git push` 列为硬禁令（`opencode.jsonc` permissions 显式 deny），理由是无人值守下避免未经人审的产出离开本机。用户此后显式要求改为「提交后自动推送」，即主动解除该硬边界。远端为自建私有库（`git.xfdzcoder.space:2222`），非公网托管，风险面低于公开仓库，但仍需质量闸与范围收窄。
- **决策**：**每批次 commit 后自动 `git push origin main`**，附带三条约束：
  1. **前置条件 = 该批门禁全绿**：`pnpm test` / `pnpm typecheck` / `pnpm lint` + 本批涉及的 `apps/web/scripts/verify-*.mjs`（改配色另含 `verify-dark.mjs`）。任一未过或因环境跑不了（缺真机凭证 / server 起不来）→ **只 commit 不 push**，原因记入 07 待办、继续下一项。
  2. **push 失败不阻塞**：非快进 / 远端不可达 / 认证失败 → 记入 07 待办，本地 commit 保留，下批开跑前重试一次；不因推送失败暂停 loop。
  3. **范围仅 `git push origin main`**：`opencode.jsonc` 放行行精确匹配该命令、且置于 deny 之后（规则后匹配优先），force-push / 其它分支 / tag 仍命中 deny。
- **影响**：`AGENTS.md` 硬边界段、`.opencode/loop-prompt.md` 边界段、`opencode.jsonc` permissions、`.gitignore`（补 `apps/server/data*.zip`，防本地备份包被 `git add` 顺带推送）四处同步改写。**D22 原文保留**，其「禁止 `git push` 及任何远端外发」部分自本条起被取代。安全基线不变：凭证仍不入日志 / 前端明文 / 入库（`.env.*` 已 gitignore），其余远端外发仍禁。
- **被否备选**：① 每 commit 就推（无质量闸，坏提交立即离开本机）；② push 失败即写 stop-file 暂停 loop（中断无人值守，与 D22「长期自我迭代」诉求冲突）；③ 自动 `git pull --rebase` 后重试（用户若从别处推过会产生意外历史改写）；④ 保持手动推送（不满足用户诉求）。

## D54 · 移除 Navidrome / Mihomo 写操作（部分取代 D51 §1/§3）

- **日期**：2026-10-01（用户指令「一、Dashboard 1. 移除 navidrome、mihomo 节点面板的写入操作」）
- **背景**：D51 为三项写操作立项（Navidrome 播放遥控 / Portainer 容器重启 / Mihomo 策略组切换）。用户此后要求**移除 Navidrome 与 Mihomo 两项写操作**，即推翻 D51 的第 1、3 项。Portainer 容器重启（第 2 项）不在本次范围，保留。移除后两个深度组件回归 D50 的"只读优先"口径。
- **决策**：整体删除两条写路径（**无 DB 迁移** —— 审计是 `app.log` 结构化 `widget.write-action`，无审计表）：
  1. **服务端**：删 `apps/server/src/navidrome/`、`apps/server/src/mihomo/` 两个 routes 目录（各含 `routes.ts` + `routes.test.ts`），`app.ts` 去注册；`connector/mihomo-nodes.ts` 删 `MihomoGroupItem.options`（仅切换弹层消费）。
  2. **前端**：删 `useNavidromeControl` / `useMihomoSelect` 两个 hook 与 `api.navidromeControl` / `api.mihomoSelect`；删专辑墙遥控行、节点面板「切换」按钮与切换确认弹层；`navidromeLibraryManifest.capabilities.actions` 声明移除。
  3. **验收**：`verify-svc.mjs` / `verify-live.mjs` 的写路径 mock 与断言移除，改为**反向断言**（"只读：无播放/暂停/切换入口"、"未命中任何写端点"），确保回归不会被静默重新引入。
- **影响**：两个组件**不可逆地回到只读**；FR-X3 写操作范围收缩为仅 Portainer 重启。删除 3 个单测（navidrome 2 + mihomo 1），新增 4 条 UI 反向断言。`01-requirements.md` FR-X3 行改写、`06-roadmap.md` 同步。
- **被否备选**：① 保留端点但前端隐藏按钮（服务端仍可被调用，不满足"移除写入操作"）；② 加开关按配置启用（用户未要求，属扩大需求范围）；③ 连 Portainer 重启一并移除（用户只点名两项，不擅自扩大）。

---

## D55 · 图表引擎选型：Apache ECharts（按需注册 + 自写 `useEcharts`）【2026-10-01 补记】

> **补记说明**（2026-10-02 勘误）：本条与 D56/D57 是**已定案、尚未落地**的选型 —— 实现队列为 07 的 Q75–Q78（批 H，截至勘误日**尚未开工**）；此前此处误写「早已在迭代中落地」，属补记时的失实表述，现改正。选型结论本身不变（保留历史，不静默改写）。

- **背景**：用户要求「通过 HTTP 或 WS 拿数据，经配置以某种图表类型展示，而不是我们提前预设」（参照 metacubexd overview 与 homarr）。需要一个可配置图表组件。
- **决策**：**Apache ECharts**，`echarts/core` **按需注册**（只引实际用到的图表/组件，控制体积）+ **自写 `useEcharts` hook**，不引 `echarts-for-react` 这类封装层。
- **被否备选**：① Recharts / Chart.js / uPlot / @mantine/charts —— 组件式 API，无法表达「用户配置图表类型」的开放配置面；② Highcharts —— **商业授权**，个人项目不接受；③ 搜索结果里的「Chart.ts / @chartts」—— 实测 npm 上 `@chartts/react` **404**，属虚假宣传，勿信。
- **影响**：构建体积需在收口时复核（见刮骨疗毒清单「构建产物体积」）。

## D56 · WS 数据源 v1：服务端 WS 客户端 + 经 `/api/events` SSE 转发【2026-10-01 补记】

- **背景**：用户要求支持 WS 协议取数。但前端传输层已冻结为 HTTP + SSE。
- **决策**：**服务端**起 WS 客户端连用户的 WS 源，收到消息后经**现有** `/api/events` SSE 推给前端。前端仍只有 HTTP + SSE，**不动 04-tech-stack 的前端传输层决策**。
- **影响**：凭证与出站仍全走服务端 connector（SEC/SSRF 基线不变）。复用现有 SSE 通道意味着无需新增前端连接管理。

## D57 · `ConfigField.dependsOn`：动态选项按字段依赖联动【2026-10-01 补记】

- **背景**：媒体墙「只看某相册 / 某艺人」的选项**必须跟着「数据连接」走**（不同连接的相册/艺人不同），而原动态选项源是**全局静态**的。
- **决策**：widget-sdk `ConfigField` 新增 `dependsOn?: string`，声明「我的 dynamic 选项以另一字段的当前值为参数」；`validateConfigSchema` 要求它必须指向同一 schema 里**已声明的其它**字段。宿主在被依赖字段变化时按 `${dynamic}:${depValue}` 重解选项。顺带修掉既有缺口：`select` 原本强制静态 `options`，现在允许 `dynamic` 顶替。
- **影响**：插件契约（D7）可跨语言读取该字段；选项源走现成数据通道（`immich-albums` / `navidrome-artists` 连接器），**零新路由**，自动继承缓存/SSRF/凭证机制。
- **踩坑留档**：Navidrome 0.58 **无 `getArtists2.view`（实测 404）**，只有 `getArtists.view`；且 Subsonic 有扁平 `artists.artist[]` 与分组 `artists.index[].artist[]` **两种响应形态**，只解析其一会静默拿到 0 项。

## D58 · 网格粒度页面配置：`columns` / `cellHeight`（做实 FR-P9）

- **背景**：用户反馈「现在的感觉有些宽了，希望行列可以更多一些，并暴露为页面的配置」。现状是 `Board.tsx` **硬编码** `column: 12` + 断点 `12/8/4/1`，`cellHeight: 80`，dashboard 表无对应字段。
- **决策**：
  1. dashboards 表新增 `columns`（默认 12）与 `cellHeight`（默认 80）两字段，**属页面级布局配置**（符合概念模型「Dashboard 只拥有布局」）。
  2. 列数档位 **12 / 16 / 20 / 24 / 28 / 32**（步长 4）。**列数并非必须是 4 的倍数**（gridstack `column` 接受任意正整数）；取 4 的倍数是为了让响应式断点取半/取四分之一时都是整数。断点按 `N → N/2 → N/4 → 1` 推导。
  3. 行高 `cellHeight` 可调 **40–200px**（默认 80）。行数不限、纵向滚动。
  4. **切列数不走 `updateOptions()`**（AGENTS.md D12 已验证它会触发 `load(children)` 重置未保存布局）：改配后重挂载网格（`key` 含 columns），并在 JS 里把 `x/w` 按比例重算落盘；`cellHeight` 用 `grid.cellHeight()` 实时改。
- **被否备选**：① 把列数塞进 `layoutJson` 的 meta 条目（污染裸 widget 数组，且语义上是页面级而非组件级）；② 直接调 `grid.column()` 而不重挂载（`columnOpts.breakpoints` 在 options 里，运行时无法同步，会与响应式打架）。
- **影响**：需要 drizzle 迁移（D18：`drizzle-kit generate`，**勿手写 DDL**）；页面设置 UI 需新增入口（FR-P9 早已列「图标、背景、列密度」，本次做实）。既有布局切换到更大列数时按比例放大并做碰撞消解。

## D59 · 卡片标题区可跳转：`homeUrl` 取绑定数据源的 `config.url`

- **背景**：用户要求「点击卡片的 Title（**仅 Title 区域 logo+文本**，不是整个卡片），跳转到对应网站（如果可以跳转的话）」，并明确「Mihomo 可以不跳转，这个是纯 api」。
- **决策**：
  1. 抽共享 `WidgetTitle`（logo + 标题 + 右侧动作），**只有标题区**可点，`target="_blank" rel="noopener noreferrer"`。整卡**不**可点（避免与卡内交互冲突）。
  2. 跳转地址 = 该组件绑定**数据源的 `config.url`**（Immich / Navidrome / Portainer / 监控均有）。无 URL（Mihomo 纯 API、信息流、Todo、看板、邮件等）→ **不渲染成链接**，只显示标题。
  3. 标题文案同批统一：服务器监控 → **数据源名称**；信息流 → **RSS**。
- **影响**：无 DB 变更（URL 已在数据源 config 里）。需要处理「数据源未选/URL 缺失」的降级 —— 退回纯文本标题。

## D60 · 媒体墙等高行等比布局：缩略图原始宽高从**字节头**解析

- **背景**：用户反馈「卡片高度过高会把缩略图拉长，期望缩略图大小完全响应式且始终等比缩放；Immich 照片墙应保持原本宽高比，不必每个都一样宽，**保持每行的高度一致即可**」。现状是数据项**不含原始宽高**，前端只能 `object-fit: cover` 裁切 + `grid-auto-rows: 1fr` 拉满卡片。
- **决策**：
  1. **宽高来源**：服务端在抓缩略图字节时解析 **JPEG SOF / PNG IHDR** 得到实际尺寸，随 item 一起下发（`width`/`height`）。**不依赖** Immich `search/metadata` 是否返回 exif 宽高 —— 字节头解析对 Immich / Navidrome 两个来源通用，且拿到的就是实际渲染尺寸。
  2. **布局**：等高行 justified —— flex 容器 `flex-wrap`，每项 `flex-basis: 行高×比例` + `flex-grow: 比例` + `aspect-ratio: 比例`。行内宽度正比于比例 ⇒ **行内等高、宽度按原比例**；末行用大 `flex-grow` 占位符防止拉伸。`object-fit` 从 `cover`（裁切）改 `fill`（框已等于图比例，无裁切无变形）。
  3. `minCell` 配置**语义改为「目标行高」**，其余交给等比布局反推实际行高。
  4. 无宽高（占位块/抓取失败）时退化为等宽格子，不破坏整行。
- **影响**：媒体墙数据契约变化（`apps/web/src/media-wall.tsx` 的 `MediaWallItem` 增 `width`/`height`。**勘误**：原文误记为「widget-sdk `MediaWallItem`」—— 该类型并不在 widget-sdk，媒体墙是 `apps/web` 内部组件，widget-sdk 无对应契约）；超出卡片高度仍纵向滚动（沿用项 6「超出滚动」）。随机模式（整卡一张图）不受影响。

> ⚠️ **本条 §2 的 flex 方案已被 D61 修订**（flex 做不到「全行等高」）。§1 字节头解析宽高、§3 目标行高语义、§4 无宽高退化仍然有效。

## D61 · 媒体墙等高行改用 **JS 行装箱**（修订 D60 §2）【2026-10-02】

- **背景**：D60 §2 定的是纯 CSS flex 等高行（`flex-basis: 行高×比例` + `flex-grow: 比例`）。实施前推演发现它**达不到用户明确要求的「保持每行的高度一致」**：flex 的 `flex-grow` 按比例分掉**整行**剩余空间，于是**每行各自撑满宽度**，但项目少的那几行分到的剩余空间更多、涨得更狠 ⇒ **行与行之间高度不等**（只有行内等高）。末行的大 `flex-grow` 占位符也只是「不拉伸」，并不能让各行等高。
- **决策**：等高行 justified 改用 **JS 行装箱**：
  1. 纯函数 `packRows(items, containerWidth, targetRowHeight, gap) → Row[]`。贪心装箱：按 `比例 × 目标行高` 累计，接近 `containerWidth` 即断行；行内统一缩放使整行恰好填满宽度 ⇒ **全行等高**（不是只有行内等高），且宽度严格正比于原始比例。
  2. **末行按自然尺寸左对齐，不拉伸**（不塞占位符、不撑满）。
  3. 容器宽度经 `ResizeObserver` 实测，`containerWidth` 变化即重算；纯函数单独可单测（比例、断行点、等高性、末行不拉伸全可断言）。
  4. 无宽高（占位块/抓取失败）按 **1:1** 参与装箱，不破坏整行（沿用 D60 §4）。
  5. `object-fit`：**已知比例**用 `fill`（框已等于图比例 ⇒ 无裁切无变形）；**未知比例**保留 `cover`（退化格子宁可裁切也不变形）。
- **被否备选**：① 纯 CSS flex（D60 §2 原案）—— 行间高度不等，直接违背需求原文；② CSS grid `masonry`/`grid-template-rows: masonry` —— 浏览器支持未落地，且不能保证等高行；③ 绝对定位瀑布流 —— 是「等宽不等高」，与需求相反。
- **影响**：只改 `apps/web`（媒体墙渲染 + 服务端下发 `width`/`height`），无 DB 变更、无 widget-sdk 变更。`minCell` 语义改「目标行高（px）」（D60 §3，仍有效）。随机模式（整卡一张图）不受影响。

> ⚠️ **本条的「行高浮动 vs 铺满宽度」取舍已被 D62 修订**：用户拍板要「每行高度一致」是**字面事实**，故改为全局固定行高 + 行尾留白。§1–§4 的其余部分（装箱、字节头解析、目标行高语义、退化策略）仍然有效。

## D62 · 媒体墙行高**全局固定** + 行尾留白（修订 D61 的取舍）【2026-10-02】

- **背景**：D61 采用业界经典 justified 口径「每行恰好铺满宽度，行高在目标附近小幅浮动」，并在文档里诚实写明「严格等比 + 铺满宽度 ⇒ 行间高度不可能完全相同」。用户复核后拍板：**要「每行的高度一致」是字面事实**，允许「固定行高 + 右侧留白」。
- **决策**：
  1. **全局统一行高** `height = min(目标行高, 容器宽 / 最大宽高比)`。取全局值（而非逐行反推）正是「所有行高度完全相同」成为字面事实的关键；`min` 里的第二项保证最宽一格也不会溢出容器。
  2. 顺序装箱（不重排）：放不下的项**换行**，行尾**允许留白**。绝不为了填满而改比例或改行高。
  3. 由此所有行（含末行）高度完全相同；末行项少、宽度自然短，**不拉伸**是自动成立的。
  4. `minCell`（目标行高）继续沿用，配置语义不变；用户可见帮助文案补充「行尾可能留白」。
- **被否备选**：① D61 的「铺满宽度 + 行高浮动」—— 用户明确不要；② 逐行 `min(目标行高, 容器宽/本行最大比例)` —— 多数情况下与全局值相同，但超宽图会让**单行**变矮，破坏「所有行等高」，故否决；③ 允许右侧留白的同时用「最优装箱」压缩留白 —— 需重排或背包求解，破坏展示顺序，收益有限，留作后续。
- **取舍的代价（明确接受，非缺陷）**：在「严格等比」+「所有行严格等高」下，各行占用宽 = 行高 × 该行比例和，而各行比例和不可能相同 ⇒ **行尾必然留白**。实测真机 8 行留白 41–171px（容器 649px）。
- **影响**：`packRows` 返回值去掉 `filled` 字段（不再有「末行」特例），`.wb-gallery__row--last` 类随之移除。真机实测行高严格 110px × 8 行，12 种真实比例 0.919–2.344 全部保持。

## D63 · `uniqueField` 语义修正：唯一性属**数据实体**，不属**展示位置**（修订 D43）【2026-10-02】

- **背景**：用户反馈「在多个页面中添加同一个 ToDo 会提示『inbox』已被同类型组件使用（不允许重名）。不应该拒绝，本来的设计就是多页面可以配置同一个 ToDo，共享一份数据」，并明确：**唯一性指的是 ToDo 的数据源的唯一性，并不是展示位置的唯一性。同一份数据可以在任何页面展示任意次。**
- **根因**：D43 的实现把两个概念混为一谈。`uniqueFieldTaken()` 扫描**全部页面的 `layoutJson`**，只要已有同 `type` 组件用了同一个值就拒绝添加/保存 —— 于是「在多个页面放同一个 Todo」被挡，直接违背「多页面共享同一份数据」的设计。
- **决策**：
  1. **删除宿主的展示侧唯一性校验**（`Board.tsx` 两处守卫 + `uniqueFieldTaken()` 函数）。同一份数据可在**任意页面、任意次数**展示。
  2. **数据实体名的唯一性由数据层保证**：如 todo 分组名在分组表内唯一，**已存在则复用**（不是报错）。这本就是数据层的不变量，与组件放几个、放哪无关。
  3. `WidgetManifest.uniqueField` **保留为语义声明**（告诉插件作者「该字段的值引用一个数据实体」），**不再触发拒绝**。插件契约（D7）字段保留、语义修正，避免破坏既有 manifest。
- **被否备选**：① 把作用域从「全站」收窄成「同页面内唯一」—— 用户已明确「任意页面任意次」，同页面也应允许；② 彻底删除 `uniqueField` 字段 —— 它仍是有效的语义声明（区分「引用数据实体的字段」与「纯展示配置」），删除会丢信息。
- **若将来确需「同页不得重复」**：那是另一个概念，应新增独立字段（如 `uniquePerDashboard`），不得再复用 `uniqueField`。
- **影响**：todo 组件帮助文案同步改写（去掉「全站不允许重名」）；无 DB 变更、无 API 变更。

## D64 · 邮件未读徽标归 Workspace：**本地已读标记**，不回写服务商【2026-10-02】

- **背景**：用户反馈③「邮件点击后，不会取消『未读标记』」。现状：点开邮件只拉正文，列表 `seen` 直接来自 IMAP `\Seen` / Gmail `SEEN` 且从不更新；`fetchMessageBody` 把返回值 `seen` 硬编码 `true`（「拉取正文视为已阅」只是返回值假象，**未持久化**，返回列表蓝点照旧）。
- **决策（用户拍板，方案 A）**：**工作台本地已读标记** ——
  1. 新表 `mail_read`（`user_id + item_key`（`= accountId:uid`）唯一索引，照 `feed_read` 模式）：**未读徽标归 Workspace**，任一组件标记、其它组件同步；
  2. `POST /api/mail/messages/:accountId/:uid/read`（幂等：重复点击不报错、不重复行）；
  3. 列表合并语义：`seen = 服务商标记 || 本地已读`；
  4. 组件**点开即乐观标记**（本地缓存先变、端点随后落库）。
- **边界不变**：**D3 只读不破** —— 不回写 IMAP `STORE +FLAGS \Seen` / Gmail `messages.modify`，服务商侧 SEEN/UNREAD 原样不动；Gmail OAuth scope 保持 `gmail.readonly`，已有账号**无需重新授权**。
- **被否备选（方案 B：回写邮箱服务商）**：① 破 D3 只读边界（IMAP 连接须从只读改可写）；② Gmail 须扩 OAuth scope 到 `modify` 并要求用户重新授权已有账号；③ 用户明确选了本地方案（「工作台本地已读（推荐）」）。
- **影响**：`mail_read` 新表（迁移 `0016`，drizzle-kit 生成）；邮件 REST +1 端点；未读徽标语义变更如上；verify-mail 增「点开 → 未读标记取消」全链路断言（夹具同步 seen + 记账端点命中）。

## D65 · HTTP 卡片（图表/自定义 API）配置语义：相对地址按来源拼接 + **卡片配置优先**【2026-10-02】

- **背景**：用户反馈⑤「添加组件添加图表的时候，接口地址给的示例有问题，应该给相对地址，而不是带域名的绝对地址，因为认证来源已经有了绝对地址了。包括下面的访问令牌，须体现出如果和认证来源不同才需要填写，不然也没必要二次填写，如果不同的话，填写了可以覆盖（不是真正的修改认证来源的 Token，只是这个卡片的独立配置优先级高于默认配置）」。经确认**同步应用到「自定义 API」**（同一组字段、同一 httpConnector 取数通道）。
- **决策（用户拍板）**：
  1. **接口地址支持相对路径**（placeholder 示例改 `/api/stats`）：相对路径按「认证来源」的站点地址拼接（`new URL(rel, base)`，建议以 `/` 开头）；未选来源/来源缺地址 → 原样提交、取数层报「原因 + 怎么修」（「请选认证来源或填完整地址」）；绝对地址照旧。
  2. **认证键优先级 = 卡片已填 > 来源**：访问令牌/认证头**与来源不同才需填写**（相同留空即自动用来源的，不必二次填写）；填了只覆盖**本卡**（**不写回来源配置**，来源仍是唯一事实来源 —— 用户原话「不是真正的修改认证来源的 Token」）。
  3. 语义靠表单 **help** 承载 —— 发现 ConfigForm 的 text/select/secret 分支**根本没渲染 `f.help`**（用户「须体现出」正卡在这），已补齐全字段渲染。
- **兼容**：`useResolvedSourceConfig` **缺省语义不变**（来源优先、内联回落 —— D42 monitor/opencode 的旧内联兼容路径不动）；新语义仅图表/自定义 API 调用点显式开启（`inlineWins` / `resolveRelativeUrl`）。
- **被否备选**：① 只改示例文案不改行为 —— 相对地址直接打不通，误导更大；② token 一律重填 —— 用户明确「相同没必要二次填写」；③ 卡片令牌写回来源 —— 用户明确否定（改的是本卡优先级，不是来源）。
- **影响**：`config-form-utils.resolveSourceConfig` 纯函数（+3 单测）；`httpConnector` 相对地址报错（D47「原因+怎么修」）；两处 manifest 字段文案；ConfigForm help 渲染修复（福及全部组件表单）；verify-chart +4 断言（placeholder/帮助文案/相对地址+来源令牌/卡片覆盖且来源不动）。

## D66 · OpenCode 组件与数据源**退役**（2026-10-02）

- **背景**：用户指令「Dashboard：① 移除专门的 OpenCode 卡片及其数据源」。该组件（FR-E4/Q8，D32）对接 opencode server experimental API，用户不再需要此卡片。
- **决策（用户拍板）**：**整体退役**，不留隐藏开关——
  1. **前端**：`opencode-widget.tsx`、manifest 与 `widgetComponents`/`manifestsByComponent`/`builtinManifests` 三清单条目、`useOpencodeData` 与 `OpencodeSession`/`OpencodeData` 类型、`data-source:opencode` 选项源、`qkRoot.opencode` 查询键、数据源类型画廊 `DS_KINDS`/`DS_FIELDS` 条目、品牌图标 `icons/brand/opencode.svg`（及 SOURCES.md 登记行）、service-overview `kindIcon` 映射。
  2. **服务端**：`connector/opencode.ts`、`data/routes.ts` 注册、`data-source` kind 白名单与 config 键表、`plugin/install.ts` `BUILTIN_TYPES`（插件不得占用 `opencode` 类型名）。
  3. **存量数据**：`data-source/legacy-cleanup.ts` 启动时一次性删除 `kind="opencode"` 连接行并**回收孤儿凭证**（复用 Q98b 的 `deleteCredentialIfOrphan`，仍被引用则保留）——这些行在新类型画廊中不可见也不可管理，留着就是僵尸数据。**只删连接配置，不动任何业务数据**（01 §1.3）。
- **顺带修正**：Q98b 的孤儿凭证回收正则只认 `"credentialId"` 键，而 config 实际存的是 SecretRef `{ credentialRef }` —— 回收从未生效过；抽出 `collectCredentialRefs()`（两种键名都认），删除路径与退役清理共用。
- **兼容口径**：旧布局 JSON 里的 `opencode` 实例走 gridstack `components[component]` 未命中 → **渲染空卡**（与插件卸载后同语义），编辑态可配置/移除；`plugin/install.ts` 类型表同步收窄，插件不能再声明 `opencode` 类型。
- **被否备选**：① 留作隐藏组件（用户明确「移除」，且依赖 experimental API 的代码本就是维护负担）；② 只删前端留 connector（孤儿 API 面，无消费方，knip 必清）。
- **影响**：apps/web 9 文件 + apps/server 5 文件 + verify 脚本 4 份（`verify-opc.mjs` 整删、`verify-i4.mjs` ④段、`verify-j8.mjs` 期望名、`capture-design.mjs` fixture）+ `legacy-cleanup` 新模块与测试；契约文档（widget-sdk README/config.ts）同步。

## D67 · iframe 默认沙箱加 `allow-same-origin` + 同源地址拒绝嵌入（2026-10-02）

- **背景**：用户反馈「iframe 中添加地址后，iframe 里的请求的 Origin 是 null，导致报错跨域」。根因：旧默认沙箱 `allow-scripts`（不含 `allow-same-origin`）使 iframe 文档成为**不透明源**——框内所有 fetch/XHR/表单请求 `Origin` 头是字符串 `"null"`，且不带 cookie/登录态，目标站按 Origin/白名单校验即报跨域。
- **决策（用户拍板，方案 A）**：
  1. **默认沙箱 = `allow-scripts allow-same-origin`**：框内页面拿回**它自己的正常源**（Origin = 目标站自身、cookie/登录态可用）；仍禁顶层导航/表单/弹窗。`sandbox` 自定义字段保留为高级项，placeholder/help 写清「去掉 allow-same-origin 会让请求 Origin 变 null 并丢登录态」。
  2. **同源自嵌一律拒绝**：`new URL(url).origin === location.origin` 时直接不加载、给出明确提示 + 新标签页逃生口——同源内容配 `allow-scripts allow-same-origin` 等价于**解除沙箱**（框内脚本可读写宿主 DOM/localStorage/会话），必须拦。
- **纯函数化**：`resolveSandbox(custom)` / `isSameOriginAsHost(url, hostOrigin)`（+4 单测，含空串回落与同源三要素）。
- **被否备选**：① 加显式开关、默认仍最小沙箱（用户选了默认可用）；② 服务端反代 iframe 内容（工程量大、破坏 Origin 语义、与 SSRF 基线耦合）。
- **兼容**：显式配过 `sandbox` 的旧组件不受影响（配置优先）；插件沙箱（D25）**保持 `allow-scripts` 不透明源不变**（插件是不可信代码，语义相反）。
- **验证**：`verify-j7` 扩 3 断言（框内 `location.origin` 非 null、框内请求回显真实 Origin 头、同源拒绝）——13/13；**真机** `verify-iframe-live`（新增）5/5：Immich 真机框内 origin = `https://immich.xfdzcoder.space`（原为 "null"）、Navidrome 真机 `X-Frame-Options: DENY` 出明确提示。

## D68 · RSS/Atom 节点归一 `textOf`：根治 `[object Object]` 与已读去重串号（2026-10-02）

- **背景**：用户反馈「`https://www.theverge.com/rss/index.xml` 这个 rss 的文章标题和描述解析失败，都是 `[object Object]`，这个应该有专门的库统一处理？」。**根因**：fast-xml-parser 配了 `ignoreAttributes: false`（Atom `<link href>` 必须靠属性解析，不能关），**带属性的元素**解析成对象 `{ "#text": 文本, "@_type": "html" }`；旧归一 `String(v)` 把对象转成 `"[object Object]"`。theverge 实为 **Atom**，`<title type="html">`/`<summary type="html">` 全是带属性节点。**附带同根因 bug**：RSS `<guid isPermaLink="true">` 同样中招 → 所有条目 `itemKey` 哈希到同一个值 → **已读去重/标记全错**。
- **决策（用户拍板，方案 = 自研归一收口，不新增依赖）**：
  1. `connector/normalize.ts` 新增 **`textOf(v)`**（节点归一唯一入口）：标量原样（数字/布尔强转）、数组取首个非空成员、对象取 `#text`（递归）、纯属性节点/无文本回 **""**（调用方据此回落）。旧 `strLoose` 的 `String(v)` 语义**取消**（`[object Object]` 无人想看），并作为 `textOf` 的冗余别名一并删除。
  2. feed 解析统一走 `plainText` = `textOf` → 剥 HTML 标签 → **手写基础实体解码**（`&amp; &lt; &gt; &quot; &apos; &nbsp;` + `&#NN;`/`&#xHH;`，越界码位原样保留）→ 压空白；标题/摘要都过（Atom `type="html"` 的 CDATA 里就是 HTML）。
  3. `itemKeyOf` 拿到的 guid/link 是干净文本（guid 空自然回落 link）——已读去重恢复正确。
- **被否备选**：① 引入 rss-parser/feedparser 整体替换 `parseEntries`（库内部仍要做节点归一，且多源聚合/tagIds/已读语义还要自己包一层，回归面大收益有限）；② 改 parser 选项关属性解析（Atom `link/@_href` 依赖属性，直接坏）；③ 只在 feed 局部打补丁不收口（其它 connector 迟早踩同一坑）。
- **验证**：+5 单测（`textOf` 各形态）+ feed 契约 +1（带属性 fixture：标题/摘要人读文本、itemKey 互不相同、标一条只清一条）；**真机（用户自己的源「bbb」= theverge）**：标题如 `Tesla’s recovery hits a speed bump`（`&#x2019;` 正确解码）、摘要纯文本、itemKey 全唯一、全表零 `[object Object]`。

## D69 · 设置页信息架构：头部四按钮 → 单「设置」+ 左右分栏（2026-10-02）

- **背景**：用户指令「把右上角的【数据源管理】【插件管理】【主题切换】【退出登录】四个按钮整合为一个设置按钮；设置页左右分栏，左菜单：账户 / 外观 / 插件 / 数据源 / 关于」。
- **决策（用户拍板）**：
  1. **入口**：头部只留一个「设置」（IconAction，移动端同样开放）；页面切换器与「编辑页面」不动。深链 `?view=settings&tab=<账户|外观|插件|数据源|关于>`；**旧 `?view=data` 兼容**映射到 settings+数据源；组件内 `wb:navigate` 跳转落到设置页「数据源」并携带原 `initialTab`。
  2. **五菜单承载既有功能**（本批一次搬完，不留功能真空）：账户 = 用户名 + 退出登录（+ 忘记口令指引）；外观 = 深浅色主题切换（原头部按钮语义不变）；插件 = `PluginAdmin` **去 Modal 化**改面板；数据源 = `DataAdmin` **7 页签整体嵌入**（`embedded` 隐藏其自身返回键，标题/搜索/页签原样）；关于 = 静态简介 + 文档入口。
  3. **移动端（D10）**：设置入口开放、「插件」菜单隐藏（管理操作桌面专属）、其余菜单可用；窄屏左菜单折叠为顶部横向滚动。
  4. **样式（D39）**：新增 `.wb-settings*` 语义类（`--wb-*` 令牌），可被 `/custom.css` 覆盖。
- **验收脚本同步（TST-23 双实现）**：kit 新增 `openSettings(page, tab)` 统一入口，12 个 puppeteer 脚本 + Playwright `journeys.spec.ts` 同步改（`数据源管理`→`设置`→`数据源`、`插件管理`→`设置`→`插件`）；「返回工作台」入口保留在设置页顶栏（脚本零迁移）。
- **被否备选**：① 设置用 Modal 弹窗（数据源管理 7 页签在弹窗里体验差，Q25c 已有「弹窗改全页」先例）；② 保留旧四按钮做快捷入口（用户明确「整合为一个」）；③ 菜单项沿用旧名「数据源管理/插件管理」以省脚本改动（脚本该跟 UI 语义走，不反向迁就脚本）。
- **影响**：`settings-admin.tsx`（新）、`App.tsx`（视图状态机 + 头部）、`plugin-admin.tsx`（去 Modal）、`data-admin.tsx`（`embedded`）、widgets.css（`.wb-settings*`）、verify-kit + 12 脚本 + e2e。

## D70 · 自定义 CSS 页内编辑器：CodeMirror 6 + 令牌/类名提示 + 自动备份回滚（2026-10-02）

- **背景**：用户指令「外观中主要包含深浅色主题切换、**自定义 CSS**」并补充「CSS 编辑器要支持**基本的语法高亮和代码提示**」。现状是「手工编辑服务器上 `./data/custom.css`」（D39 契约，`GET /custom.css` 合成下发）。
- **决策（用户拍板）**：
  1. **内核 = CodeMirror 6**（`@codemirror/{state,view,language,lang-css,autocomplete,commands}` + `@lezer/highlight`）：模块化按需、体积可控、主题可桥 `--wb-*` 令牌跟随深浅色；React 接入层**自写薄封装**（`css-editor.tsx`，对齐 D55「自写 useEcharts」风格，不引 react 封装层）。
  2. **提示范围**：标准 CSS 属性/取值（`cssCompletionSource`）+ **本工作台 `--wb-*` 设计令牌与 `.wb-*` 语义类名**。提示数据源 = `?raw` 导入 `tokens.css`/`widgets.css` **运行时提取**（`css-hints.ts`）——零生成物、改令牌/加类提示自动跟上；另加括号配对/自动闭合/撤销重做。
  3. **保存前轻校验**（`lintCss`：括号配平、注释/字符串感知）——**不阻断保存**，只提示「原因 + 怎么修」（D47 口径）。
  4. **自动备份 + 回滚**：保存前旧内容自动入 `dataDir/custom-css-history/`（id = 时间戳 + 随机后缀，严格白名单防穿越；封顶 20 份）；回滚前当前内容同样先备份（回滚也可回滚）。REST：`GET/PUT /api/styles/custom-css` + `POST /api/styles/custom-css/restore`（登录态 + 256KB 上限 + **固定文件路径**，不接受路径参数）。
  5. **保存即生效**：bust `<link href="/custom.css">` 缓存重取（D39 层叠不变：用户段仍拼在桥接段后）。
- **被否备选**：① Monaco（体积 ~1MB+、Worker 配置复杂，LAN 单用户工作台偏重）；② textarea + Prism 只做高亮（用户明确要"代码提示"）；③ 构建期生成提示清单 JSON（多一步生成物、易失同步，`?raw` 更简单）。
- **验证**：`css-hints` 单测（提取规则 + lint 语义）、`styles/routes` 契约测试 5 项（保存/备份/回滚/穿越拒绝/上限/封顶）；**真机 `verify-css.mjs` 14/14**（提示给到真令牌与真类名 = `?raw`→提取→补全 UI 全链路；保存生效对账 `/custom.css`；备份条目；回滚后 hotpink 消失；结尾还原原始内容）。
- **坑留档**：vitest 下 `?raw` 的 CSS 被 stub 成空串（`test.css` 默认 false）——「真实样式表→提示」这类断言只能在浏览器面验（verify-css），单测保持纯函数。
