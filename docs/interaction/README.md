# 交互逻辑文档库（教程基座）

> **定位**：① 全站交互逻辑的权威描述（教程/手册的素材基座）；② Q23 交互走查的载体 —— 走查中发现的**所有样式/逻辑问题**登记在 [00-issues.md](00-issues.md)（★ 第一交付物）。
> 原则：**文档 = 真实行为**。每条描述来自代码事件处理、25 个 verify 脚本断言（交互契约）与 FR/D 决策记录的交叉核对。

## 目录导航（页面 → 组件 → 按钮 两级目录 + 文内三级）

| 层级 | 位置 | 内容 |
|---|---|---|
| 问题台账 | [00-issues.md](00-issues.md) | ★ 全部样式/逻辑问题（分级、复现、证据、Q24 建议） |
| 按钮总索引 | [00-button-index.md](00-button-index.md) | 全站按钮/交互点一览（含确认/写回/同步标注） |
| 页面 | [pages/01-login.md](pages/01-login.md) · [02-workspace.md](pages/02-workspace.md) · [03-edit-mode.md](pages/03-edit-mode.md) | 页面结构 → 组件 → 按钮/交互点 |
| 组件 | [components/](components/)：todo · rss · kanban · mail · monitor · service-overview · ~~opencode~~（**已退役 D66**，存档保留） · launcher · iframe · custom-api · placeholder-statbox · plugin-widget · **immich-gallery · navidrome-library · portainer-containers · mihomo-nodes**（只读深度组件，D50） | 内置组件的配置、数据流、状态与交互点 |
| 交互面 | [surfaces/](surfaces/)：widget-picker · config-form · confirm · data-admin · plugin-admin · detail-modals · plugin-runtime | 弹窗/管理面/插件体系 |
| 截图 | [assets/](assets/) | 关键态截图，命名 = 文档引用锚点 |

## 全局交互约定（各篇交叉引用此处）

| 约定 | 决策 | 要点 |
|---|---|---|
| 编辑/浏览态 | **D38** | 编辑 = 只动布局（组件内容 `inert`）；浏览 = 组件内操作 |
| 拖拽手势 | **D29** | 编辑态拖布局；浏览态 HTML5 DnD 拖卡片；「移动到」为触控/键盘备选 |
| 破坏性确认 | **D31/D34** | 删除页面/列/卡片/任务/账号、卸载插件、退订一律二次确认；**唯一豁免** = 布局编辑内移除组件 |
| 配置写回 | **D28** | 组件内配置变更（选看板、标签筛选）→ `grid.update` 写回 props + requestSave 持久化 |
| 标签与数据 | **D40 / FR-D1~D4** | 数据归 Workspace；组件按标签选数据（服务端过滤）；数据源管理面统一管理 |
| 实时同步 | **FR-I6** | 数据变更经 SSE 通知全部组件；断线 30s 轮询兜底、60s 重试 SSE |
| 移动端 | **D10 / NFR2** | 移动端仅浏览 + 组件内操作，禁布局编辑；触控目标 ≥44px；≤480px 单列 |
| 样式契约 | **D39** | 一切样式走 `--wb-*` 令牌 + `.wb-*` 语义类；用户 `./data/custom.css` 可覆盖全部 |
| 布局保存 | FR-P4 | 布局变更 800ms 防抖自动保存；退出编辑立即 flush |

## 功能点条目模板（教程级细节）

每个按钮/交互点按以下字段记录（缺失项标「—」）：

```
### <按钮/交互点名>
- 位置：页面/组件内的具体位置
- 前置条件：何时可见、何时可用（禁用条件）
- 触发：点击 / 拖拽 / 键盘 / 触摸；快捷键与无障碍（aria、焦点）
- 逐步行为：① ② ③ …（点击后的时序：UI 变化、请求、数据流、SSE）
- 状态与边界：默认 / hover / 按下 / 加载 / 禁用 / 空态 / 极值
- 错误态与恢复：失败表现、重试路径
- 配置关联：configSchema 字段（类型/默认值/约束）
- 联动：确认弹窗（D31/D34）、写回（D28）、同步（FR-I6）
- 截图：assets/…
- 问题：⚠ ISS-#（如有）
```

## 截图管线

`apps/web/scripts/capture-interaction.mjs`（需 server + preview，同 verify 栈）——数据面用请求拦截夹具喂真实形状数据，按文档锚点采集关键态截图到 `assets/`，可重复运行覆盖。命名约定：

- `p##-*` 页面级 · `c-*` 组件级 · `s-*` 交互面级 · `iss-*` 问题态证据

## 使用方式（教程编写指引）

1. 教程按「页面旅程」组织时：取 `pages/` 一篇为骨架，向内取 `components/` 对应篇的功能点细节；
2. 功能点细节可直接展开为教程步骤（「逐步行为」即步骤序列）；
3. 问题条目（00-issues）在教程定稿前应清零或标注已知问题。
