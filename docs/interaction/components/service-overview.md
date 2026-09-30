# 组件 · 服务概览

> 层级：页面 → 组件 → 按钮。约定见 [../README.md](../README.md)；问题见 [../00-issues.md](../00-issues.md)。
> FR-X2（Q39/D46）：Immich / Navidrome / Portainer / Mihomo（metacubexd 归 mihomo）**只做连接与展示**——探活 + 版本 + 关键计数。

## 配置（configSchema）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sourceId` | select（动态 `data-source:service`） | — | 数据连接（immich/navidrome/portainer/mihomo）——在「数据源管理 · 数据连接」维护 |
| `refreshSec` | number | 60 | 标准刷新字段 |

## 数据流

```
POST /api/widgets/data { type:"service-overview", config:{ sourceId } }
  ──► 服务端按连接 kind 派发适配器（connector/service.ts）
  ──► ServiceOverview { probe{ok,version,error}, stats[{label,value}] }
```

- 连接细节（地址/认证）**不出服务端**（sourceId 派发；secret 解析入内存不落日志）。
- 各服务计数接口缺失时 best-effort 省略（不报错）；探活失败返回 `probe.ok=false`，组件显式提示（不空白）。
- 认证（D46）：immich/portainer = API Key；navidrome = Subsonic u/p（salt+token md5，口令不入 URL）；mihomo = Bearer secret。内网目标走 allowPrivate 通道（monitor 同族）。

## 结构

| 区块 | 内容 |
|---|---|
| 头部 | 服务官方图标（按连接 kind）+ 连接名 + 版本徽标（如 `v1.18.8`）/「探测失败」+「详情」+「刷新」 |
| 计数卡列 | 每指标一张卡：标签（左、次要）+ 数值（右、加粗）；无计数则显「已连接（该服务未提供计数指标）」 |
| 空态 | 「暂未选择数据连接 —— 请到数据源管理·数据连接添加」+「去添加连接」跳转（wb:navigate tab=sources） |
| 弹层 | 服务概览原始 JSON（FR-I4） |

## 各服务 v1 指标

| 服务 | 指标 |
|---|---|
| Immich | 照片 / 视频 / 占用 |
| Navidrome | 歌曲 / 专辑 / 艺术家（getStats 为 Navidrome 扩展，缺失省略） |
| Portainer | 端点 / 容器（`N/M 运行中`） |
| Mihomo | 代理 / 内存 |

## 交互点

### 按钮 · 详情

- **触发**：弹窗「详情 · 服务概览原始数据（FR-I4)」——完整 JSON。

### 按钮 · 刷新

- **触发**：force 回源（FR-I3；5s 最小间隔限流由服务端数据通道统一承担）。

### 行为边界

- 深度操作（照片墙/播放/容器操作/代理切换）**不提供**（FR-X3 二期另立需求）。
- 组件删除/页面删除不影响连接数据（FR-D4）。
