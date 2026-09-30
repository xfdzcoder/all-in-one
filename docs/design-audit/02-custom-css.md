# 自定义样式指南（CSS 定制契约）

> Q19b 起，**用户可以覆盖全部 CSS**。本文是定制入口的唯一事实来源：
> 令牌（变量）→ 语义类名 → 用户样式表，三层均可被覆盖，全程无需 `!important`。

## 1. 怎么写自定义样式

把 CSS 写进 **`./data/custom.css`**（与 `app.db` 同目录，随数据卷持久化，镜像升级不丢），即刻生效：

```css
/* 例：换成紫色主题、更大的圆角、更小的字号 */
:root {
  --wb-color-accent: #7c5cff;
  --wb-radius-md: 16px;
  --wb-text-md: 13px;
}
```

服务端把它与 **Mantine 令牌桥** 合并后经 `/custom.css` 下发，该表在 `index.html` **末尾**加载：

```
打包 CSS（index.css ← tokens.css ← widgets.css）
  → Mantine 运行时注入
    → /custom.css（Mantine 令牌桥 → 用户 custom.css，段内后写覆盖前写）
```

因此**用户的任何声明都天然赢得层叠**，不需要 `!important`。

## 2. 覆盖令牌（推荐，全局生效）

全部设计决策都收敛在 `apps/web/src/styles/tokens.css` 的 `--wb-*` 变量：

| 组 | 令牌 |
| --- | --- |
| 表面 | `--wb-color-bg` `--wb-color-surface` `--wb-color-surface-hover` `--wb-color-surface-raised` `--wb-color-border` `--wb-color-border-strong` `--wb-color-overlay` |
| 文本 | `--wb-color-text` `--wb-color-text-secondary` `--wb-color-text-muted` |
| 语义色 | `--wb-color-accent` `--wb-color-accent-hover` `--wb-color-success` `--wb-color-warning` `--wb-color-danger` `--wb-color-info` |
| 间距 | `--wb-space-1/2/3/4/6/8`（4/8/12/16/24/32px，8pt 网格） |
| 圆角/边框/阴影 | `--wb-radius-sm/md/lg` `--wb-border` `--wb-shadow-modal` |
| 字体/字阶/字重 | `--wb-font-sans` `--wb-font-mono` `--wb-text-xs/sm/md/lg/xl/2xl` `--wb-leading` `--wb-weight-regular/medium/semibold` |
| 过渡/触控 | `--wb-transition` `--wb-touch-min`（NFR2 下限 44px，调低自负可达性风险） |

Mantine 组件库的变量已桥接到令牌（`apps/server/src/styles-bridge.ts`）：改 `--wb-color-text-muted` 等即同时改变 Mantine 的 dimmed/placeholder 等派生色。

## 3. 覆盖规则（局部定制）

组件结构使用稳定的语义类名（BEM 风格，`apps/web/src/styles/widgets.css`），类名即公共 API：

| 类 | 用途 |
| --- | --- |
| `.wb-widget` | 组件卡片容器（含内边距/圆角/边框） |
| `.wb-widget__header` `__title` `__actions` `__body` `__hint` | 卡片头部/标题/操作区/内容区 |
| `.wb-card` `.wb-card--interactive` | 通用小卡片（可交互态） |
| `.wb-row` | 列表行 |
| `.wb-pill` | 药丸（快捷启动等） |
| `.wb-metric` `__label` `__value` `__hint` | 指标卡 |
| `.wb-text` `.wb-text--secondary/--muted/--sm/--xs` | 文本语义 |
| `.wb-header` `.wb-brand` `.wb-toolbar` | 页面头部/品牌/工具栏 |

```css
/* 例：看板卡片里的行改成紧凑风；组件卡片去掉边框改投影 */
.wb-row { padding: 2px 0; }
.wb-widget { border: none; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
```

## 4. 约束与保证

- **组件代码禁止内联 `style`**（内联不可覆盖）；样式只允许 `--wb-*` 令牌 + `.wb-*` 语义类（Q19b 起对组件外壳生效，Q19c 继续向内部推进）。
- `tokens.css` / `widgets.css` **不使用 `!important`**；唯一例外是移动端触控目标下限（NFR2 可达性规则，`index.css`，调低请自行评估 NFR2）。
- 新增样式同样走「令牌 + 语义类」，否则视同违规。
- 若直接覆盖 Mantine 原生变量（如 `--mantine-color-dimmed`），用与桥接相同或更高的选择器 `:root[data-mantine-color-scheme]`；一般不需要——覆盖 `--wb-*` 源令牌即可。
