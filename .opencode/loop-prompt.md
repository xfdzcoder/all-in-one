# 自主迭代循环 · 每轮工作指令（all-in-one 个人工作台）

本文件由 `/loop --prompt-file` 注入，定义每轮迭代协议。授权范围与边界见 `docs/feature-plan/02-decisions.md` **D22**。

## 每轮协议（严格按序）

1. **读状态**：`docs/feature-plan/07-iteration-progress.md`（队列/记录/待确认）与 `docs/feature-plan/06-roadmap.md`（迭代项来源）。已完成项 `[x]` 不要重做。
2. **停止检查**：若用户最近一条消息要求停止/暂停（如「停止」「stop」「暂停」「先停一下」），**不要开始任何新工作**：创建文件 `.opencode/opencode-loop/STOP`，在 07 的历轮记录追加一行，输出简短总结后结束本轮。
3. **选一项**：取迭代队列中最靠前的未完成项，**一次只做一项**（小步、可验收）。队列为空时，从 06-roadmap §1 二期候选 / §3 待定清单按优先级补录并继续。**不得扩大需求范围**（01-requirements §1.2/§2.3 的非目标禁止实现）。
4. **实现**：遵循 AGENTS.md「架构不变量」与 Monorepo 边界；改 `apps/server/src/db/schema.ts` 必须 `pnpm --filter @all-in-one/server exec drizzle-kit generate`（D18，勿手写 DDL）。
5. **自测**：`pnpm test` / `pnpm typecheck` / `pnpm lint`（按改动面选择，测试必须全绿）；涉及 UI 行为用 `apps/web/scripts/verify-*.mjs` 验证；涉及部署做本地 Docker 构建验证。
6. **落盘**：
   - 自测全绿后**单独一条** git commit（英文 conventional commits，**不 push**）；
   - 更新 `docs/feature-plan/07-iteration-progress.md`：完成项标 `[x]`，历轮记录追加「做了什么 / 验证结果 / commit」；
   - 涉及需求或技术决策：更新 `01-requirements.md` 并向 `02-decisions.md` **追加**新 D# 条目（保留历史，不改写旧结论）；范围变化同步 `06-roadmap.md`。
7. **汇报**：本轮结束输出 ≤10 行摘要：完成项、验证结果、commit、下一步。

## 边界（D22 授权范围）

- **允许**：实现代码、跑测试/构建、本地 `git commit`、推进 06-roadmap 迭代项、按维护约定更新 01/02/06/07 文档、本地 Docker 构建与部署验证。
- **禁止**：`git push` 及任何远端外发；凭证入日志/前端明文（安全基线不变）；实现非目标功能；破坏性 shell 操作。
- **需要用户拍板的产品决策**：记入 07「待用户确认」清单并**跳过该项**，继续下一项，不要自行拍板。

## 失败处理

- 测试失败：先修复再继续；`--verify` 失败会触发暂停（`--pause-on-verify-fail`），等待用户介入。
- 连续失败或无进展：在 07 记录卡点，拆小或跳过该项，不要反复消耗 token。
