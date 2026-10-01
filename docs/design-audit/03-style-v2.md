# 视觉规范 v2（D52 · A 克制精致 + 玻璃光感背景）

> **Q59 产出**（2026-10-01）。方向由样张圈定（Q58：`../design-audit/style-v2/` 四张对照，用户选 **02「A+玻璃背景」**）。
> 契约不变（D39）：所有视觉只经 `--wb-*` 令牌与 `.wb-*` 语义类表达，`./data/custom.css` 仍可整体覆盖。

## 1. 风格基调

- **A 克制精致**（Linear/Vercel 工具感）为骨：tinted slate 深色分层、细边框微光、精确排版、克制动效；
- **玻璃光感**为氛围：卡片半透明 + `backdrop-blur`（`--wb-surface-glass-alpha` / `--wb-blur`）、背景三色光晕（`--wb-bg-glow-*`）；
- **按钮尽量 icon 化**（用户要求，Q65）：图标 + tooltip + aria-label；文字按钮保留给关键/有歧义操作（如"删除"类仍可用图标+红色语义）。

## 2. 令牌族（tokens.css）

| 族 | 关键令牌 | 说明 |
|---|---|---|
| 表面 | `--wb-color-bg/surface/surface-hover/surface-raised` | tinted slate（蓝紫偏）四级 |
| 玻璃/氛围 | `--wb-surface-glass-alpha`、`--wb-blur`、`--wb-bg-glow-1/2/3` | 玻璃透明度、模糊、背景光晕三色 |
| 文本 | `--wb-color-text/-secondary/-muted` | AA 双主题守护（verify-dark） |
| 语义 | `--wb-color-accent(+hover/-glow)/success/warning/danger/info` | accent 带 glow 供渐变按钮 |
| 形状 | `--wb-radius-sm/md/lg/pill` | 8/12/16/999 |
| 阴影 | `--wb-shadow-card/-card-hover/-modal` | 多层柔和阴影（替代单投影） |
| 字体 | `--wb-font-sans`（Inter Variable）、`--wb-text-display`、`--wb-weight-bold`、`--wb-tracking-tight` | 展示级数字排版（tabular-nums 全局开） |
| 动效 | `--wb-motion-fast/base/slow`、`--wb-ease-out`、`--wb-transition` | 120/180/280ms，统一缓动 |

## 3. 主题结构

- `:root` = 深色（默认）；`:root[data-theme="light"]` = 浅色变量组（Q63 接线切换与 AA 双主题校验）。
- 浅色同样保持玻璃质感（玻璃透明度调高、光晕减淡）。

## 4. 分批落地（队列 Q60–Q65）

批1 基础层（令牌生效/背景氛围/滚动条/焦点环/Mantine 同步）→ 批2 组件层（卡片 hover 抬升/按钮渐变/徽标/弹窗/表单）→ 批3 内容层（数字排版/骨架屏/空态）→ 批4 浅色主题 → 批5 微交互+走查 → Q65 按钮 icon 化（含 verify 脚本选择器 text→aria-label 迁移）。

## 5. 验收口径

每批：前后截图对照（design-audit 管线）+ verify-dark WCAG AA + 全量 verify/Vitest 回归；不破坏 D39 覆盖契约（custom.css 覆盖用例保持）。
