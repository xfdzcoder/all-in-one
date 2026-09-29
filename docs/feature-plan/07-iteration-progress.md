# 07 · 自主迭代进度（loop 状态文件）

> 本文件是自主迭代 loop 的**状态落盘**（`/loop --progress-file` 指向此处），也是人工审计入口。授权与边界见 [02-decisions.md](02-decisions.md) **D22**，每轮协议见仓库根 `.opencode/loop-prompt.md`。随迭代更新。

## 当前状态

| 项 | 值 |
|---|---|
| 模式 | 自主迭代 loop（D22） |
| 循环状态 | **运行中**（首轮 2026-09-29 启动，队列已同步） |
| 最近更新 | 2026-09-29（第 25 轮完成 · Q17 ✅ D31 一致性扫尾（D34）；下一项 Q18 全量验收回归 + 文档收口） |

## 迭代队列

> 首轮（2026-09-29）由 loop 同步：先收口 05-mvp 未完成项（出口标准 J1–J8 记录），再按 [06-roadmap.md](06-roadmap.md) §1 二期候选 / §3 待定清单排入；完成项标记 `[x]`。大项在选中当轮再拆小步。

- [x] Q1 · 组件选择器 + configSchema 驱动添加表单（FR-W2 收口：manifest 清单驱动选择器，替换 Board 硬编码添加按钮；同步 verify-m1/j4/j5 与 Playwright J2b/J4 用例）**✅ 2026-09-29**
- [x] Q2 · J6/J7 验收脚本化（verify-j6.mjs / verify-j7.mjs；复跑 verify-m1/j3/j4/j5）**✅ 2026-09-29**
- [x] Q3 · J8 扩展机制验收脚本化 + [05-mvp.md](05-mvp.md) 出口标准勾选（J1–J8 全绿记录落盘）**✅ 2026-09-29**
- [x] Q4 · 组件配置变更（FR-W4 生命周期收口：编辑已有组件的 configSchema 配置）**✅ 2026-09-29**
- [x] Q5 · 二期：代码级插件（FR-W5③ + FR-W6 管理 + FR-W7 沙箱/权限声明；Q5a–Q5d 全部完成）**✅ 2026-09-29**
  - [x] Q5a · 插件 ABI 契约（PluginManifest + 权限白名单 + apiVersion + validatePluginManifest + 规范文档，D7 契约先行，**D24**）**✅ 2026-09-29**
  - [x] Q5b · 插件包上传/校验/存储（服务端：zip 解析 → validatePluginManifest → plugin 表（D18 drizzle）+ REST）**✅ 2026-09-29**
  - [x] Q5c · 插件运行时加载与沙箱（FR-W7 落地形态选型：**D25 = iframe CSP**）+ 启用/禁用**✅ 2026-09-29**
  - [x] Q5d-1 · 插件管理页（上传 → 校验报错 → 启用/禁用/卸载 + 权限声明展示，FR-W6/FR-W7 可见性）**✅ 2026-09-29**
  - [x] Q5d-2 · 数据桥（capabilities.data → 宿主数据通道）+ 权限白名单执行（widgets.data / credentialKinds / 数据源白名单，**D26**）**✅ 2026-09-29**
  - [x] Q5d-3 · 插件动作执行通道（permissions.actions 白名单 + 服务端固定 registry 执行 + 审计日志，**D27**）**✅ 2026-09-29**
- [x] Q6 · 二期：Kanban 组件（多项目看板 + 卡片操作 + 嵌套拖拽手势专门设计；Q6a–Q6c 全部完成）**✅ 2026-09-29**
  - [x] Q6a · 数据模型 + REST（board/column/card 三层（D21 归属 + 级联删除）、卡片移动/归档、SSE kanban 主题）**✅ 2026-09-29**
  - [x] Q6b · KanbanWidget 组件（列/卡渲染、加列加卡、改卡/归档/删除、组件内选看板（配置写回，D28）、Workspace 数据 + SSE 同步）**✅ 2026-09-29**
  - [x] Q6c · 嵌套拖拽手势方案（**D29**：模式互斥——编辑态拖布局/浏览态 HTML5 DnD 拖卡片 + 「移动到」选择器触控/键盘备选）**✅ 2026-09-29**
- [x] Q7 · 二期：邮件组件（只读，IMAP connector；D3 只读边界不变；Q7a–Q7b 全部完成）**✅ 2026-09-29**
  - [x] Q7a · 数据模型 + IMAP 聚合服务 + REST（mail_account（D21+凭证引用）、imapflow/mailparser 适配、多账号聚合/错误隔离/60s 缓存、正文体积截断、**D30**）**✅ 2026-09-29**
  - [x] Q7b · 邮件组件 UI（账号管理（口令入凭证库）、聚合列表 + 逐账号错误、正文沙箱渲染（D25 工具）、账号过滤）**✅ 2026-09-29**
- [x] Q11 · 破坏性操作防误触（**D31**：ConfirmAction 二次确认 —— 删除页面/列/卡片/账号、卸载插件；布局编辑内组件移除不加确认）**✅ 2026-09-29**
- [x] Q8 · 二期：OpenCode 组件（**D32**：直接 HTTP 薄封装 + API 版本探测容错；会话列表/状态/耗时）**✅ 2026-09-29**
- [ ] Q9 · 二期：服务器监控组件（**待用户确认：06 待定 #4 数据来源选型**（node-exporter / agent / 后端直采）——本轮跳过，见「待用户确认」#2）
- [ ] Q10 · 二期：自定义 API 受限 JS/JSX 模板（**待用户确认：06 待定 #5 安全边界**——本轮跳过，见「待用户确认」#3）
- [x] Q12 · 部署回归：Docker 单镜像构建 + 容器冒烟 + deploy 文档同步（新增依赖/插件目录/内网出站语义）**✅ 2026-09-29**
- [x] Q13 · FR-P1 完整化：页面重命名 + 排序（上移/下移 + sortOrder 重编号）——FR 审计发现的【必须】缺口**✅ 2026-09-29**
- [ ] Q14 · FR-I2/I3 收口【必须】（**拆分为 Q14a–Q14b**）
  - [x] Q14a · 标准刷新频率配置（capabilities.refresh → 表单通用字段 → props.refreshSec）+ 定时刷新（refetchInterval，配置值优先/默认值兜底）**✅ 2026-09-29**
  - [x] Q14b · 手动刷新按钮统一（todo/rss/custom-api/launcher/kanban 补齐 + force 回源语义）+ 状态审计（加载态补 kanban）**✅ 2026-09-29**
- [x] Q15 · FR-I4 组件内查看详情（抽屉/弹层）——信息流/Todo/自定义 API/OpenCode 四处弹层（capabilities.detail 全部兑现）**✅ 2026-09-29**
- [x] Q17 · D31 一致性扫尾（**D34**：清单内单项删除同样确认 —— Todo 任务删除/RSS 退订；唯一豁免 = 布局编辑内组件移除）**✅ 2026-09-29**
- [ ] Q18 · 文档收口：widget-sdk 契约 README 补齐宿主标准行为（FR-I2 标准刷新字段、D28 requestSave 宿主服务、FR-I4 详情约定）+ 全量验收回归
- [ ] Q16 · FR-P9 页面级设置 + FR-I6 轮询兜底【应该】（**拆分为 Q16a–Q16b**）
  - [x] Q16a · 页面设置：图标 + 背景色（列密度不提供——与冻结的 D6/D12 断点模型冲突，已在实现说明中记录）**✅ 2026-09-29**
  - [x] Q16b · FR-I6 轮询兜底（SSE 断线/放弃重连时 30s 间隔失效查询；60s 重试 SSE 自动恢复低延迟路径）**✅ 2026-09-29**

## 历轮记录

| # | 日期 | 内容 | 验证 | commit |
|---|---|---|---|---|
| 1 | 2026-09-29 | **Q1 组件选择器 + configSchema 添加表单**：新增 `WidgetPicker`（builtinManifests 清单 → ConfigForm 默认值 → 确认添加）；Board 六个硬编码添加按钮 + custom-api 专属弹窗整体替换，todo 清单/过滤、应用入口 itemsJson、iframe URL/沙箱等均改为表单可配（FR-W2 收口，J6/J7 前置）；secret → 凭证引用逻辑通用化（SEC3）；`widgetComponents` 增加 manifest.type 别名。附带：verify-m1/j4/j5 与 Playwright J2b/J4 改走选择器流程；J2 拖拽前置重置首页 seed 布局（历史布局占落点，gridstack 50% 碰撞规则）、J3 任务标题按轮唯一（Workspace 任务跨轮累积导致 strict 冲突） | `pnpm test` 65/65 ✅；typecheck/lint ✅；verify-m1 13/13、verify-j3 8/8、verify-j4 11/11、verify-j5 10/10 ✅；Playwright J1–J4 5/5（连跑两轮均可重复）✅ | `2f6e2bd` |
| 2 | 2026-09-29 | **Q2 J6/J7 验收脚本化**：新增 verify-j6（应用入口：选择器配 itemsJson → HTTP/TCP 探活 1/2 在线 + 绿/红徽标 → 点击新标签页跳转）与 verify-j7（iframe：自定义/默认沙箱 + 禁嵌提示 + 逃生口）。验收揭出两个真 bug 并修复（**D23**）：① Chrome 禁嵌时仍触发 iframe load 事件，前端超时启发式永不生效 → 新增服务端 `iframe-embed` connector 读响应头判定（XFO/frame-ancestors，逐跳 SSRF、allowPrivate 通道）；② 空字符串沙箱绕过默认最小集 → 回落 `allow-scripts`；iframe manifest 移除失效的 `timeoutSec`。附带：verify-j4 / Playwright J4 任务标题按轮唯一 + 按行勾选（Workspace 任务累积导致盲点第一个 checkbox 抖动） | `pnpm test` 78/78（新增 13 项）✅；typecheck/lint ✅；verify-m1 13/13、verify-j3 8/8、verify-j4 11/11（连跑两轮）、verify-j5 10/10、verify-j6 12/12、verify-j7 9/9 ✅；Playwright J1–J4 5/5 ✅ | `e5adffb` |
| 3 | 2026-09-29 | **Q3 J8 验收脚本化 + MVP 出口收口**：新增 verify-j8（① widget-sdk README 契约规范锚点 + validateManifest 导出；② "新增组件不改核心"结构检查 —— Board.tsx 零组件硬编码、widget-registry 单点注册；③ 零代码组件样例 —— 自定义 API 纯 configSchema 表单 + D14 声明式模板渲染上游数据，选择器清单由 builtinManifests 驱动 7 项）。05-mvp 出口标准 J1–J8 勾选并落盘全绿记录，README 测试状态同步 | 全量 J1–J8 扫描：Playwright 5/5、verify-m1 13/13、j3 8/8、j4 11/11、j5 10/10、j6 12/12、j7 9/9、j8 12/12 ✅；Vitest 78/78 ✅ | `fdf3d3c` |
| 4 | 2026-09-29 | **Q4 组件配置变更（FR-W4 收口）**：新增 `WidgetChrome` 编辑态外框（`useGridStackItem` 取实例 id，浏览态/移动端隐藏）+ Board 配置弹窗（manifest 预填 → ConfigForm → `grid.update` 写回 props + 手动保存，props-only 更新不触发 change 事件）；secret 未改动保留原凭证引用（SEC3 不重复入库）；注册表统一 `withWidgetChrome` 套用，组件实现零改动（J8）。修复：Mantine 关闭态 Modal 留空 `.mantine-Modal-root` 遮蔽首元素选择器 —— 配置弹窗按需挂载 + verify-j6/j7/j8 字段查找跨全部 root；verify-w4 实例定位改 gs-id 差集（累积布局下 DOM 顺序漂移） | `pnpm test` 78/78 ✅；typecheck/lint ✅；verify-w4 18/18（连跑两轮）、verify-m1 13/13、j3 8/8、j4 11/11、j5 10/10、j6 12/12、j7 9/9、j8 12/12 ✅；Playwright J1–J4 5/5 ✅ | `775e3aa` |
| 5 | 2026-09-29 | **Q5a 插件 ABI 契约（二期·代码级插件第一小步，D7 契约先行）**：widget-sdk 新增 `PluginManifest`（WidgetManifest + `plugin: { entry, apiVersion, permissions? }`）与 `validatePluginManifest`——entry 限包内相对 ESM 路径（`isSafePluginEntry` 拒绝对路径/穿越/隐藏段）、apiVersion semver、权限显式白名单（apis/credentialKinds/actions，未知键拒绝，缺省最小权限）；README 落正式插件 ABI 规范（包格式/信任模型 K7/沙箱边界/FR-W6 生命周期）。决策记 **D24**。Q5 拆为 Q5a–Q5d | widget-sdk 契约测试 12/12（新增 7 项）✅；`pnpm test` 全绿（server 78/78）✅；typecheck/lint ✅ | `968dc82` |
| 6 | 2026-09-29 | **Q5b 插件包上传/校验/存储**：`plugin` 表（D21 归属 + type 唯一 + manifest_json/dir/status，迁移 0004 由 drizzle-kit 生成，D18）；`plugin/package.ts` zip 解析（fflate 依赖）——条目名安全（拒绝对路径/穿越/隐藏段/反斜杠）、条目数与解压体积先验限额（防 zip bomb）、manifest.json 走 `validatePluginManifest`（D24）、entry 模块必须在包内；`install.ts` 安装=解包→落盘 `dataDir/plugins/<type>-<id>/`→登记，拒绝内置类型占用与 apiVersion 主版本不兼容（`HOST_API_VERSION`），卸载只删目录+登记（不动业务数据）；REST POST/GET/DELETE（鉴权，重复 type 409）。`config.dataDir` 改动态 getter | server 测试 91/91（新增 13 项：包解析 7 + API 6，含穿越 zip/保留类型/卸载清目录）✅；`pnpm test` 全绿 ✅；typecheck/lint ✅ | `f0e473e` |
| 7 | 2026-09-29 | **Q5c 插件运行时加载与沙箱（D25）+ 启用/禁用**：`plugin-frame.tsx` 沙箱宿主——iframe `sandbox="allow-scripts"`（不透明源）+ srcdoc CSP（`connect-src 'none'` 等，插件零网络）、入口经 data: URL 框内 `import()`（自包含、源码不进宿主作用域）、结构化 postMessage 桥（sourceWindow 校验）+ 运行时 ABI `render(props, ctx)`；启用插件按 manifest.type 动态注册进 components/选择器/配置表单（J8 不改核心，组件实例模块级缓存防重挂载）；动作按 permissions.actions 白名单放行。服务端 enable/disable（启用复核 apiVersion）+ entry 源码以 JSON 下发。**D25**：iframe CSP，否决 Web Component（Shadow DOM 不隔离 JS）。附带：脚本侧 REST 调用不发空 body Content-Type（Fastify 400） | verify-pl5 22/22（安装→选择器→配置表单→沙箱渲染（不透明源/存储拒/no-cors fetch 被 CSP 拦）→配置变更过桥重渲染→禁用/卸载）✅；server 92/92 ✅；全量 verify（m1/j3–j8/w4）✅；Playwright J1–J4 5/5 ✅；typecheck/lint ✅ | `cae7c28` |
| 8 | 2026-09-29 | **Q5d-1 插件管理页（FR-W6）**：`plugin-admin.tsx` 管理弹窗（header 入口，桌面端限定 D10）——zip 上传（体积上限 + base64 走安装 API）、校验错误原样展示、列表状态徽标（未启用/已启用/已禁用）+ **权限声明展示**（FR-W7 可见性：apis/凭证/动作 chips）、启用/禁用/卸载；所有变更失效 ["plugins"] 查询 → 选择器与动态注册免刷新即时更新（收口 Q5c 发现的清单过期问题）。verify-pl6 覆盖管理旅程 | verify-pl6 20/20（非法包报错→安装→未启用+权限摘要→启用→免刷新进选择器→禁用→卸载清理）✅；全量回归（m1/j3–j8/w4/pl5）✅；Playwright J1–J4 5/5 ✅；Vitest 92/92 ✅；typecheck/lint ✅ | `bf59f3a` |
| 9 | 2026-09-29 | **Q5d-2 插件数据桥 + 权限白名单执行（D26）**：服务端 `plugin/data.ts`——插件取数走宿主统一数据通道（type = 插件 type），数据源白名单 v1 = http-connector/none（config 键沿用 http connector 约定）、`permissions.apis` 须含 `widgets.data`、`credentialKinds` 按凭证件 kind 在**解密前**逐个把关（`getCredentialMeta`，拒绝 403+原因；禁用/未安装=未知类型 400）；data 路由插件分支跳过无守卫预解析（否则 SecretRef 先被解开、守卫失效）。Web：`usePluginData` 统一取数 → data 经桥进沙箱，取数报错宿主侧横幅。决策记 **D26** | server 测试 98/98（新增 6 项：桥路由/apis 拒绝/credentialKinds 拒绝+放行注入/no-source/禁用）✅；verify-pl7 17/17（UI 权限矩阵：沙箱渲染含鉴权注入的数据、两类越权可见报错）✅；全量回归（m1/j3–j8/w4/pl5/pl6）✅；Playwright 5/5 ✅；typecheck/lint ✅ | `5905f15` |
| 10 | 2026-09-29 | **Q5d-3 插件动作执行通道（D27）**：`plugin/actions.ts` 服务端固定 registry（v1 = todo.create/todo.toggle/feed.markRead，zod 参数校验、薄封装既有写操作）——动作名 `permissions.actions` 白名单（宿主桥先拒 + 服务端复核）、未声明 403/未知 400/参数非法 400/禁用 400；每次执行记结构化审计日志（who/plugin/action，**参数不入日志**）+ 按主题失效缓存与 SSE；PluginFrame 桥接派发 + 失败可见报错。**Q5（代码级插件）Q5a–Q5d 全部完成** | server 103/103（新增 5 项）✅；verify-pl8 18/18（沙箱按钮→桥→服务端建任务→工作台可见；未声明动作可见拒绝且零写入）✅；全量回归（m1/j3–j8/w4/pl5–pl7）✅；Playwright 5/5 ✅；typecheck/lint ✅ | `dc4fd3b` |
| 11 | 2026-09-29 | **Q6a Kanban 数据模型 + REST**：`kanban_board`/`kanban_column`/`kanban_card` 三层（D21 归属、看板/列级联删除、归档=非破坏卡片操作），迁移 0005（drizzle-kit，D18）；REST boards 列表/树/增改删 + columns/cards CRUD（zod + 鉴权 + 404 规范），卡片移动 = PATCH columnId+sortOrder（同看板校验），写操作发 SSE `kanban` 主题（FR-I6）。Q6 拆为 Q6a–Q6c | server 111/111（新增 8 项：排序/跨列移动/归档/跨看板拒绝/级联删除/非法体）✅；typecheck/lint ✅；verify-m1 冒烟 13/13 ✅ | `0af0e91` |
| 12 | 2026-09-29 | **Q6b KanbanWidget 组件（D28）**：`kanban-widget.tsx`——组件内新建/切换看板（选择即配置写回 `grid.update(props)` + 宿主 `requestSave` 服务，**D28**）、列渲染与加列/删列/改名、加卡/改卡/移动到列/归档/删除（编辑弹窗）；SSE 失效改按 topic 分发（顺带修复 rss/kanban 事件只失效 todo 查询的隐患）；`WidgetEditContext` 升级为宿主服务上下文。**踩坑修复**：React setState updater 渲染期重放，`e.currentTarget` 在 updater 内读取 → null 崩溃（卡片输入框）；verify-kan 前置重置 seed 布局防组件累积歧义 | verify-kan 27/27（连跑两轮：建看板/列/卡、改卡、跨列移动、归档、刷新保持 props 往返）✅；全量回归（m1/j3–j8/w4/pl5–pl8）✅；Playwright 5/5 ✅；Vitest 111/111 ✅；typecheck/lint ✅ | `9baf261` |
| 13 | 2026-09-29 | **Q6c 嵌套拖拽手势方案（D29）**：卡片拖拽 vs gridstack 布局拖拽冲突 = **模式互斥**——编辑态卡片 `draggable=false` + 提示（拖动=调整布局），浏览态 HTML5 DnD（卡片 dragstart → 列 drop），与 gridstack 指针路径完全解耦；移动语义=落目标列末尾（sortOrder=列内最大+1），与「移动到」选择器共用 `moveCardTo`（触控/键盘备选，移动端 D10 天然走选择器）。**Q6 Kanban（Q6a–Q6c）全部完成** | verify-kan 33/33（连跑两轮：新增编辑态不可拖+提示、浏览态合成拖放跨列移动断言）✅；全量回归（m1/j3–j8/w4/pl5–pl8）✅；Playwright 5/5 ✅；Vitest 111/111 ✅；typecheck/lint ✅ | `19226e7` |
| 14 | 2026-09-29 | **Q7a 邮件数据模型 + IMAP 只读聚合（D30）**：`mail_account` 表（D21 归属 + 凭证引用，迁移 0006）；`mail/client.ts` 窄接口 + `imap.ts` imapflow/mailparser 薄适配（逐次连接/登出）+ `service.ts` 账号 CRUD/多账号聚合（逐账号错误隔离 + 60s TTL 缓存）/正文拉取与截断（text 100KB、html 200KB）；REST 账号 + 聚合列表 + 正文，**无任何写邮箱端点**（D3）；SEC4：IMAP 目标过 SSRF 基线；SEC3：密码只存凭证引用、连接期解密入内存。**D30**：IMAP-only（Gmail API 专项入待用户确认）、正文沙箱 iframe 渲染（Q7b 落地） | server 117/117（新增 6 项：聚合排序/挂掉与内网账号隔离/TTL 单次连接/密码不入响应/截断/404·400）✅；typecheck/lint ✅；verify-m1 冒烟 13/13 ✅ | `560cf0b` |
| 15 | 2026-09-29 | **Q7b 邮件组件 UI**：`mail-widget.tsx`——组件内账号管理（口令走 `createCredential` 入凭证库、账号只存引用，SEC3；账号创建请求不携带口令）、聚合列表 + 逐账号错误横幅 + 账号过滤、正文**沙箱 iframe 渲染**（deny-all + CSP `script-src 'none'`、远程图禁；纯文本回退）；`mail` 注册进组件表/选择器/BUILTIN_TYPES。verify-mail 25/25（消息 API 用请求拦截夹具，IMAP 路径由服务层假客户端单测覆盖）。**测试事故与修复**：未限定范围的 `clickBtn("删除")` 命中「删除此页」误删活动看板（首页）——清理点击改弹窗内精确匹配、重建首页种子布局、清空 40 个脚本累积的测试页、verify-m1/j3 显式点「首页」tab（不再依赖 tab 顺序）；新增队列 Q11（破坏性操作加确认对话框）。**Q7 邮件（Q7a–Q7b）全部完成** | verify-mail 25/25（连跑两轮）✅；全量 14 个 verify 脚本 231 项全绿（m1/j3–j8/w4/kan/mail/pl5–pl8）✅；Playwright 5/5 ✅；Vitest 117/117 ✅；typecheck/lint ✅ | `0316a4c` |
| 16 | 2026-09-29 | **Q11 破坏性操作二次确认（D31）**：共享 `ConfirmAction`（触发按钮 + 确认弹窗「确认」/「取消」，文案顺带说明数据边界），覆盖删除页面（App）、看板列（提示连带卡片数）/卡片、邮件账号、卸载插件；布局编辑内组件移除（拖拽/删除最后）不加确认（编辑流程不被弹窗打断）。自动化改为「触发 → 确认」两步 | 全量 14 个 verify 脚本 248 项全绿（verify-m1 21/21 含删除页旅程：弹窗文案/取消保留/确认删除；mail 26/26、pl6 21/21 过确认步）✅；Playwright 5/5 ✅；Vitest 117/117 ✅；typecheck/lint ✅ | `b5ec0af` |
| 17 | 2026-09-29 | **Q8 OpenCode 组件（D32）**：`connector/opencode.ts` 直接 HTTP 薄封装（**不引官方 SDK**，绑定面最小）——`/app` 版本探测（best-effort）+ `/session` 列表归一（兼容 `time.{created,updated}` 与扁平字段、耗时=差值、新→旧、条数上限、Bearer 凭证注入、SSRF 基线原因明示）；**探测容错**：不可达/形状不符返回 `probe{ok,error}` 由组件显式提示（experimental API 漂移免疫，不空白）。`opencode-widget.tsx`：版本徽标、会话卡（标题/耗时/更新时间）、探测失败横幅、手动刷新强制回源（尊重 5s 限流）。决策记 **D32** | server 122/122（新增 5 项：探测归一/令牌注入/形状不符/不可达/缺配置+SSRF 原因）✅；verify-opc 12/12（连跑两轮：版本徽标、会话/耗时、Bearer 注入、限流后刷新回源、不兼容 API 横幅）✅；全量 15 脚本 260 项 ✅；Playwright 5/5 ✅；typecheck/lint ✅ | `6ade3bc` |
| 18 | 2026-09-29 | **第 18 轮：队列收口 + Q12 部署回归**：① 按 D22 跳过规则把 **Q9（监控数据来源，待定 #4）/ Q10（受限 JS 模板安全边界，待定 #5）列入「待用户确认」**（#2/#3）并跳过；② 06 §3 待定 #1/#2 按实现定论结案（**D33**：Todo 模型 = list/title/done/sortOrder + 组件过滤；RSS 源管理 = 组件内配置）；③ **Q12 部署回归**：Docker 单镜像构建（含 fflate/imapflow/mailparser 新依赖）+ 容器冒烟（health/SPA/登录/看板种子/mail·plugins·kanban API/日志零密钥）+ deploy 文档与 compose 注释同步（`data/plugins` 随 `./data` 备份、内网出站语义澄清） | docker build ✅；容器冒烟 6 项 ✅（含密码/主密钥日志脱敏检查）；文档同步 ✅ | `2c503a0`、`dfd4997` |
| 19 | 2026-09-29 | **Q13 FR-P1 完整化（页面重命名 + 排序）**：对 01 冻结 FR 做覆盖审计，发现【必须】缺口 FR-P1（重命名/排序无 UI）、FR-I2/I3（刷新频率不可配、无定时刷新）——Q13 本轮完成：重命名弹窗（条件挂载，Enter 提交）+ 上移/下移（移动后 sortOrder 统一重编号，规避全 0 交换无效）；`patchDashboard` 类型对齐服务端（title/icon/sortOrder/layoutJson）。审计结论补录 Q14–Q16（FR-I2/I3 刷新收口、FR-I4 详情抽屉、FR-P9+FR-I6）。**事故复盘**：清理步骤在 reload 后误删首页（活动 tab 重置为第一个）——脚本改为先选中目标 tab + 确认弹窗必须点名目标页 + 断言首页幸存 | verify-m1 35/35（含 P1 重命名/排序/刷新持久化 14 项）✅；全量 15 脚本 277 项 ✅；Playwright 5/5 ✅；Vitest 122/122 ✅；typecheck/lint ✅ | `703a962` |
| 20 | 2026-09-29 | **Q14a 刷新频率配置 + 定时刷新（FR-I2/I3）**：`ConfigForm` 在 manifest 声明 `capabilities.refresh` 时渲染标准「刷新频率（秒）」字段（选择器添加表单 + 配置编辑表单通用，存 `props.refreshSec`，下限= minRefreshSec）；全部数据 hooks 接 `refetchInterval`（配置值优先，否则组件 manifest 默认：todo/kanban 60s、launcher 120s、custom-api/rss/mail 300s、opencode 60s；Workspace 组件另有 SSE 同步）。verify-opc 新增 3 项（刷新频率持久化、定时刷新产生数据通道流量且无需手动、双组件分离保证手动刷新断言确定性） | verify-opc 15/15（连跑两轮）✅；全量 15 脚本 280 项 ✅；Playwright 5/5 ✅；Vitest 122/122 ✅；typecheck/lint ✅ | `3dfd187` |
| 21 | 2026-09-29 | **Q14b 手动刷新统一 + 回源语义（FR-I3 收口）**：todo/rss/custom-api/launcher/kanban 补「刷新」按钮（浏览模式可用；custom-api 的可点 Badge 规范为 Button）；**force 回源语义**——通道型（custom-api/launcher/rss）手动刷新带 force 穿透服务端 TTL，邮件加 `force=1` 穿透列表缓存（服务端 + 单测），REST 型直接重取；kanban 补加载态。verify-fr3 27/27（五按钮存在+可点、todo/kanban 请求计数、custom-api/launcher 刷新达上游 mock = 缓存穿透实证）。**测试竞态修复**：verify-mail 的消息夹具改为从一开始就拦截（真实 IMAP 尝试迟到覆盖查询缓存），首个响应为空保留空态断言；verify-mail/verify-opc 的刷新点击改为组件内定位（新增的共享按钮遮蔽了全文档匹配） | 全量 16 脚本 307 项 ✅；Playwright 5/5 ✅；Vitest 123/123 ✅；typecheck/lint ✅ | `0696b8b` |
| 22 | 2026-09-29 | **Q15 FR-I4 组件内详情（弹层）**：声明 `capabilities.detail` 的四个组件全部兑现——信息流（条目点击→弹层：标题/来源/摘要沙箱渲染+阅读原文；顺带标记已读，S6）、Todo（任务点击→标题/清单/状态/时间）、自定义 API（「详情」→完整响应 JSON，超出模板投影）、OpenCode（会话→ID/创建/更新/耗时）；摘要沙箱抽为共享 `html-sandbox.tsx`（与邮件共用）。verify-i4 21/21（四弹层内容断言 + 摘要注入脚本零执行实证） | 全量 17 脚本 328 项 ✅；Playwright 5/5 ✅；Vitest 123/123 ✅；typecheck/lint ✅ | `c924850` |
| 23 | 2026-09-29 | **Q16a 页面设置（FR-P9）**：重命名弹窗升级为「页面设置」（名称/图标/背景色）——`dashboard.background` 列 + 迁移 0007（drizzle-kit，D18）、patch 面扩展（背景空 = 回落默认底色）；tab 显示图标前缀、活动页背景应用到主区。**列密度不提供**：与冻结的 D6/D12 单布局断点模型冲突（页面列数会破坏跨端布局语义）。dashboard 路由测试补图标/背景置清断言。verify-m1 P9 旅程 8 项（弹窗/tab 图标/计算背景色/刷新持久化） | verify-m1 43/43（连跑两轮）✅；全量 17 脚本 336 项 ✅；Playwright 5/5 ✅；Vitest 123/123 ✅；typecheck/lint ✅ | `79b34cb` |
| 24 | 2026-09-29 | **Q16b FR-I6 轮询兜底**：`useSseInvalidation` 优雅降级——瞬时断线走浏览器自动重连；**放弃重连（CLOSED，如反代故障）→ 30s 间隔失效全部数据查询兜底**，并每 60s 重试 SSE、连通即停轮询（自动恢复低延迟路径）。verify-i6 3/3（/api/events 全程 500 模拟：零操作下 33s 窗口内出现 /api/todos 自动请求；todo 自身 60s 刷新不重叠窗口；工作台保持可用） | 全量 18 脚本 339 项 ✅；Playwright 5/5 ✅；Vitest 123/123 ✅；typecheck/lint ✅ | `4157c20` |
| 25 | 2026-09-29 | **Q17 D31 一致性扫尾（D34）**：清单内「×」删除/退订接入二次确认——Todo 任务删除（ConfirmAction，弹窗点名任务）、RSS 源退订（共享确认弹窗，已读保留/可重订）；`ConfirmAction` 弹窗改按需挂载（关闭态 Modal 留空 root，逐行实例会膨胀 DOM）。**D34** 细化边界：凡不可逆删除/退订/卸载一律确认，唯一豁免 = 布局编辑内组件移除。verify-d31 15/15（两条路径 × 取消保留/确认删除 + 弹窗点名核对；× 按钮行级定位——首个 × 属历史任务的同款选择器陷阱） | 全量 19 脚本 354 项 ✅；Playwright 5/5 ✅；Vitest 123/123 ✅；typecheck/lint ✅ | `85588ad` |

## 待用户确认

| # | 问题 | 提出轮次 | 状态 |
|---|---|---|---|
| 1 | 邮件 connector 是否需要 Gmail API 专项（06 待定 #3：IMAP + 应用专用密码是否够用；OAuth 体验 vs 实现复杂度）——不影响已落地的 IMAP 版 | 第 14 轮（Q7a/D30） | 待用户确认 |
| 2 | 服务器监控数据来源选型（06 待定 #4）：node-exporter / agent / 后端直采 —— 影响部署复杂度（是否需额外组件），Q9 在此定案前不动工 | 第 18 轮（Q9 拆解） | 待用户确认 |
| 3 | 自定义 API 受限 JS/JSX 模板的安全边界（06 待定 #5）：模板表达力升级的沙箱/能力边界 —— 影响二期扩展面，Q10 在此定案前不动工 | 第 18 轮（Q10 拆解） | 待用户确认 |

## 停止 / 恢复

- **停止**（二选一）：
  1. 会话内直接发「停止」类指令——loop 协议要求 agent 创建 `.opencode/opencode-loop/STOP` 并暂停调度；
  2. 直接执行 `/loop-stop`（停止）、`/loop-pause`（暂停）、`/loop-clear`（清除全部循环任务）。
- **恢复**：`/loop-resume`，或按 D22 中的启动命令重新执行 `/loop`（注意删除 `.opencode/opencode-loop/STOP`）。
- 运行时状态与日志在 `.opencode/opencode-loop/`（已 gitignore）。
