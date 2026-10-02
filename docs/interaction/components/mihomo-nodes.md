# 组件 · Mihomo 节点面板

> 层级：页面 → 组件 → 按钮。约定见 [../README.md](../README.md)；问题见 [../00-issues.md](../00-issues.md)。
> FR：FR-X3 只读深度（**D50**，Q53 落地）；**策略组切换已 D54 移除**（改代理出口影响全网流量，回归纯只读）。

**截图**：待补（`assets/c-mihomo-nodes.png`）。

## 配置（configSchema）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sourceId` | select（动态） | — | **数据连接**（Mihomo / external-controller） |
| `refreshSec` | number | 60 | 标准刷新字段 |

## 数据流

```
POST /api/widgets/data { type:"mihomo-nodes", config:{ sourceId } }
  ──► /proxies（策略组与节点）+ /providers/proxies（订阅源汇总）
  ──► groups / nodes / providers 归一（延迟尾点；订阅源失败单独 note，SRV-08 后含「怎么修」）
```

> 概览类指标（出口选择/流量/连接数）在**服务概览**卡片（Mihomo 形态），不在本组件（Q69 职责划分）。

## 结构

| 区块 | 内容 |
|---|---|
| 头部 | WidgetTitle：logo + 「节点面板 · <数据源名>」（Mihomo 无站点 URL → 标题**不渲染成链接**，D59）+「刷新」 |
| 策略组区 | 每组：组名 + 当前节点 + 延迟徽标（`ok/warn/bad` 色阶） |
| 节点区 | 节点名 + 延迟（ms）+ 可用性 |
| 订阅源区 | 每源：名 + 节点数 + 更新时间 |

## 交互点

### 按钮 · 刷新

- **触发**：force 回源（FR-I3）。

> **无「切换」按钮**（D54 明确移除，verify-svc/verify-live 有反向断言防回归）；面板纯展示。

## 已知问题

见 [../00-issues.md](../00-issues.md)。
