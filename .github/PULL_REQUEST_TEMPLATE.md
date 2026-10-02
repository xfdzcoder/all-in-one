## 变更内容

<!-- 一句话概括这个 PR 做了什么 -->

## 动机与关联

<!-- 解决什么问题？关联 Issue（Closes #xx）或决策编号（D#）？ -->

## 变更类型

- [ ] 缺陷修复
- [ ] 新功能 / 组件
- [ ] 文档
- [ ] 重构 / 依赖 / 构建

## 提交前检查

- [ ] `pnpm test` / `pnpm typecheck` / `pnpm lint` 全绿
- [ ] UI 行为改动已跑相关 `pnpm verify` 脚本（含配色改动的 `verify-dark.mjs`）
- [ ] 文档已同步更新（README / docs/deploy.md / 交互文档）
- [ ] 需求或决策有变化：已更新 `01-requirements.md` 并向 `02-decisions.md` 追加 `D#` 条目
- [ ] 新增组件 / 接入第三方服务 / 改动卡片指标：已过 `08-widget-quality.md` 质量门禁（含真机验证）
- [ ] 无凭证、密钥、cookie、个人数据入库或进入日志
- [ ] 每个提交为单一主题的英文 conventional commit
