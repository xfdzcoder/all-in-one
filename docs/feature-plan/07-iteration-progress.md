# 07 · 自主迭代进度（loop 状态文件）

> 本文件是自主迭代 loop 的**状态落盘**（`/loop --progress-file` 指向此处），也是人工审计入口。授权与边界见 [02-decisions.md](02-decisions.md) **D22**，每轮协议见仓库根 `.opencode/loop-prompt.md`。随迭代更新。

## 当前状态

| 项 | 值 |
|---|---|
| 模式 | 自主迭代 loop（D22） |
| 循环状态 | **运行中**（首轮 2026-09-29 启动，队列已同步） |
| 最近更新 | 2026-09-29（第 5 轮完成 · Q5a ✅ 插件 ABI 契约（D24）；下一项 Q5b 插件包上传/校验/存储） |

## 迭代队列

> 首轮（2026-09-29）由 loop 同步：先收口 05-mvp 未完成项（出口标准 J1–J8 记录），再按 [06-roadmap.md](06-roadmap.md) §1 二期候选 / §3 待定清单排入；完成项标记 `[x]`。大项在选中当轮再拆小步。

- [x] Q1 · 组件选择器 + configSchema 驱动添加表单（FR-W2 收口：manifest 清单驱动选择器，替换 Board 硬编码添加按钮；同步 verify-m1/j4/j5 与 Playwright J2b/J4 用例）**✅ 2026-09-29**
- [x] Q2 · J6/J7 验收脚本化（verify-j6.mjs / verify-j7.mjs；复跑 verify-m1/j3/j4/j5）**✅ 2026-09-29**
- [x] Q3 · J8 扩展机制验收脚本化 + [05-mvp.md](05-mvp.md) 出口标准勾选（J1–J8 全绿记录落盘）**✅ 2026-09-29**
- [x] Q4 · 组件配置变更（FR-W4 生命周期收口：编辑已有组件的 configSchema 配置）**✅ 2026-09-29**
- [ ] Q5 · 二期：代码级插件（FR-W5③ + FR-W6 管理 + FR-W7 沙箱/权限声明；**拆分为 Q5a–Q5d 逐轮推进**）
  - [x] Q5a · 插件 ABI 契约（PluginManifest + 权限白名单 + apiVersion + validatePluginManifest + 规范文档，D7 契约先行，**D24**）**✅ 2026-09-29**
  - [ ] Q5b · 插件包上传/校验/存储（服务端：zip 解析 → validatePluginManifest → plugin 表（D18 drizzle）+ REST）
  - [ ] Q5c · 插件运行时加载与沙箱（FR-W7 落地形态选型：iframe CSP vs Web Component → 记 D25）+ 启用/禁用
  - [ ] Q5d · 插件管理页（上传 → 校验 → 启用/禁用/卸载，FR-W6）+ 权限白名单执行（越权拒绝）
- [ ] Q6 · 二期：Kanban 组件（依赖布局引擎拖拽冲突方案，见 06 §1）
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
