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

---

## 命名约定（非编号决策，已确认）

- 顶层概念 **Workspace（空间/工作台）**，其下 **Dashboard（页面）**，再下 **Widget（组件）**；文档统一用 Workspace 作顶层。
- 概念模型详见 [01-requirements.md](01-requirements.md) §1.3。
