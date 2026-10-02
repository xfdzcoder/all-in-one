# 品牌图标来源与许可

| 文件 | 服务 | 来源 | 许可 |
|---|---|---|---|
| `gmail.svg` | Gmail | simple-icons（cdn.simpleicons.org/gmail，品牌色 #EA4335） | CC0 |
| `rss.svg` | RSS | simple-icons（cdn.simpleicons.org/rss） | CC0 |
| `glances.svg` | Glances | homarr-labs/dashboard-icons（svg/glances.svg，官方彩标） | 集合 MIT；商标归各自所有者 |
| `immich.svg` | Immich | simple-icons（cdn.simpleicons.org/immich） | CC0 |
| `portainer.svg` | Portainer | simple-icons（cdn.simpleicons.org/portainer） | CC0 |
| `navidrome.svg` | Navidrome | homarr-labs/dashboard-icons（svg/navidrome.svg） | 集合 MIT；商标归各自所有者 |
| `mihomo.png` | Mihomo / metacubexd | MetaCubeX/mihomo（Alpha/docs/logo.png，官方 logo） | 仓库许可；商标归 MetaCubeX（metacubexd 无独立品牌标，共用 Mihomo 家族 logo） |

> 使用方式仅限「以官方图标标识对应服务」（nominative use）。新增服务图标时在此登记来源与许可。

## UI 图标（非品牌）

| 位置 | 集合 | 来源 | 许可 |
|---|---|---|---|
| `apps/web/src/icons.tsx`（16 个内联组件） | Tabler Icons **outline** | tabler.io/icons（`@tabler/icons` 的 `icons/outline/*.svg`，仅作 SVG→JSX 属性改写） | MIT，Copyright (c) 2020-2024 Paweł Kuna |

> 为什么内联而不引 `@tabler/icons-react`：该包 vite dev 预构建整包 16MB（全库只用 16 个图标），
> 是 DevTools 面板卡顿的最大单一来源（见 07 记录 197）。
