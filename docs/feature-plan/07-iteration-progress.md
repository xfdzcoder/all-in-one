# 07 · 自主迭代进度（loop 状态文件）

> 本文件是自主迭代 loop 的**状态落盘**（`/loop --progress-file` 指向此处），也是人工审计入口。授权与边界见 [02-decisions.md](02-decisions.md) **D22**，每轮协议见仓库根 `.opencode/loop-prompt.md`。随迭代更新。

## 当前状态

| 项 | 值 |
|---|---|
| 模式 | 自主迭代 loop（D22） |
| 循环状态 | **未启动**（等待在 TUI 中执行 `/loop`，见 D22 启动命令） |
| 最近更新 | — |

## 迭代队列

> 首轮启动后由 loop 从 [06-roadmap.md](06-roadmap.md) §1 二期候选 / §3 待定清单同步；完成项标记 `[x]`。

- [ ] （待首轮同步）

## 历轮记录

| # | 日期 | 内容 | 验证 | commit |
|---|---|---|---|---|
| — | — | 尚未开始 | — | — |

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
