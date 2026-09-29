# 07 · 自主迭代进度（loop 状态文件）

> 本文件是自主迭代 loop 的**状态落盘**（`/loop --progress-file` 指向此处），也是人工审计入口。授权与边界见 [02-decisions.md](02-decisions.md) **D22**，每轮协议见仓库根 `.opencode/loop-prompt.md`。随迭代更新。

## 当前状态

| 项 | 值 |
|---|---|
| 模式 | 自主迭代 loop（D22） |
| 循环状态 | **运行中**（首轮 2026-09-29 启动，队列已同步） |
| 最近更新 | 2026-09-29（第 12 轮完成 · Q6b ✅ Kanban 组件（D28）；下一项 Q6c 嵌套拖拽手势方案） |

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
- [ ] Q6 · 二期：Kanban 组件（多项目看板 + 卡片操作 + 嵌套拖拽手势专门设计；**拆分为 Q6a–Q6c 逐轮推进**）
  - [x] Q6a · 数据模型 + REST（board/column/card 三层（D21 归属 + 级联删除）、卡片移动/归档、SSE kanban 主题）**✅ 2026-09-29**
  - [x] Q6b · KanbanWidget 组件（列/卡渲染、加列加卡、改卡/归档/删除、组件内选看板（配置写回，D28）、Workspace 数据 + SSE 同步）**✅ 2026-09-29**
  - [ ] Q6c · 嵌套拖拽手势方案（卡片移动 vs gridstack 布局拖拽冲突专门设计 + 触控/键盘可达的移动备选）
- [ ] Q7 · 二期：邮件组件（只读，IMAP connector；D3 只读边界不变）
- [ ] Q8 · 二期：OpenCode 组件（薄封装官方 SDK，experimental API 风险）
- [ ] Q9 · 二期：服务器监控组件（**阻塞：06 待定 #4 数据来源选型**，届时进"待用户确认"）
- [ ] Q10 · 二期：自定义 API 受限 JS/JSX 模板（**阻塞：06 待定 #5 安全边界**，届时进"待用户确认"）

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

## 待用户确认

| # | 问题 | 提出轮次 | 状态 |
|---|---|---|---|
| — | — | — | — |

## 停止 / 恢复

- **停止**（二选一）：
  1. 会话内直接发「停止」类指令——loop 协议要求 agent 创建 `.opencode/opencode-loop/STOP` 并暂停调度；
  2. 直接执行 `/loop-stop`（停止）、`/loop-pause`（暂停）、`/loop-clear`（清除全部循环任务）。
- **恢复**：`/loop-resume`，或按 D22 中的启动命令重新执行 `/loop`（注意删除 `.opencode/opencode-loop/STOP`）。
- 运行时状态与日志在 `.opencode/opencode-loop/`（已 gitignore）。
