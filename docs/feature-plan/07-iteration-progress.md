# 07 · 自主迭代进度（loop 状态文件）

> 本文件是自主迭代 loop 的**状态落盘**（`/loop --progress-file` 指向此处），也是人工审计入口。授权与边界见 [02-decisions.md](02-decisions.md) **D22**，每轮协议见仓库根 `.opencode/loop-prompt.md`。随迭代更新。

## 当前状态

| 项 | 值 |
|---|---|
| 模式 | 自主迭代 loop（D22） |
| 循环状态 | **运行中**（首轮 2026-09-29 启动，队列已同步） |
| 最近更新 | 2026-09-29（第 1 轮完成 · Q1 ✅，下一项 Q2） |

## 迭代队列

> 首轮（2026-09-29）由 loop 同步：先收口 05-mvp 未完成项（出口标准 J1–J8 记录），再按 [06-roadmap.md](06-roadmap.md) §1 二期候选 / §3 待定清单排入；完成项标记 `[x]`。大项在选中当轮再拆小步。

- [x] Q1 · 组件选择器 + configSchema 驱动添加表单（FR-W2 收口：manifest 清单驱动选择器，替换 Board 硬编码添加按钮；同步 verify-m1/j4/j5 与 Playwright J2b/J4 用例）**✅ 2026-09-29**
- [ ] Q2 · J6/J7 验收脚本化（verify-j6.mjs / verify-j7.mjs；复跑 verify-m1/j3/j4/j5）
- [ ] Q3 · J8 扩展机制验收脚本化 + [05-mvp.md](05-mvp.md) 出口标准勾选（J1–J8 全绿记录落盘）
- [ ] Q4 · 组件配置变更（FR-W4 生命周期收口：编辑已有组件的 configSchema 配置）
- [ ] Q5 · 二期：代码级插件（FR-W5③ + FR-W6 管理 + FR-W7 沙箱/权限声明；FR-W7 落地形态涉及产品决策，届时视情况进"待用户确认"）
- [ ] Q6 · 二期：Kanban 组件（依赖布局引擎拖拽冲突方案，见 06 §1）
- [ ] Q7 · 二期：邮件组件（只读，IMAP connector；D3 只读边界不变）
- [ ] Q8 · 二期：OpenCode 组件（薄封装官方 SDK，experimental API 风险）
- [ ] Q9 · 二期：服务器监控组件（**阻塞：06 待定 #4 数据来源选型**，届时进"待用户确认"）
- [ ] Q10 · 二期：自定义 API 受限 JS/JSX 模板（**阻塞：06 待定 #5 安全边界**，届时进"待用户确认"）

## 历轮记录

| # | 日期 | 内容 | 验证 | commit |
|---|---|---|---|---|
| 1 | 2026-09-29 | **Q1 组件选择器 + configSchema 添加表单**：新增 `WidgetPicker`（builtinManifests 清单 → ConfigForm 默认值 → 确认添加）；Board 六个硬编码添加按钮 + custom-api 专属弹窗整体替换，todo 清单/过滤、应用入口 itemsJson、iframe URL/沙箱等均改为表单可配（FR-W2 收口，J6/J7 前置）；secret → 凭证引用逻辑通用化（SEC3）；`widgetComponents` 增加 manifest.type 别名。附带：verify-m1/j4/j5 与 Playwright J2b/J4 改走选择器流程；J2 拖拽前置重置首页 seed 布局（历史布局占落点，gridstack 50% 碰撞规则）、J3 任务标题按轮唯一（Workspace 任务跨轮累积导致 strict 冲突） | `pnpm test` 65/65 ✅；typecheck/lint ✅；verify-m1 13/13、verify-j3 8/8、verify-j4 11/11、verify-j5 10/10 ✅；Playwright J1–J4 5/5（连跑两轮均可重复）✅ | `2f6e2bd` |

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
