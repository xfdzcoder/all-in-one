# 组件 · Portainer 容器清单

> 层级：页面 → 组件 → 按钮。约定见 [../README.md](../README.md)；问题见 [../00-issues.md](../00-issues.md)。
> FR：FR-X3 只读深度（**D50**，Q52 落地）+ **唯一保留的写操作**（容器重启，**D51/Q56**：白名单 + 二次确认）。

**截图**：待补（`assets/c-portainer-containers.png`）。

## 配置（configSchema）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sourceId` | select（动态） | — | **数据连接**（Portainer）；重启白名单 `restartAllow` 在**连接配置**里维护（逗号分隔或数组；**空 = 禁止一切重启**） |

## 数据流

```
POST /api/widgets/data { type:"portainer-containers", config:{ sourceId } }
  ──► /api/endpoints → containers/json?all=1 + docker/info
  ──► containers: [{ id, name, state, status, ports, abnormal }] + host 汇总
POST /api/portainer/restart { containerId }（D51：白名单 + 审计日志）
```

## 结构

| 区块 | 内容 |
|---|---|
| 头部 | WidgetTitle：logo + 「容器清单 · <数据源名>」（标题区跳 Portainer 站点，D59）+ N/M 正常徽标 +「刷新」 |
| 容器行 | `.wb-container-row` **CSS Grid 四列**（名称 / 状态徽标 / 状态详情·端口 / 操作），≤640px 降两列；异常行红色高亮、徽标不参与压缩（Q93） |
| 异常区 | 异常容器清单（用户头号问题「容器都活着吗」优先呈现，D48） |

## 交互点

### 行 · 点击 → 日志尾部（只读）

- **触发**：点击容器行（`div role="button"` + Enter/Space 可达 —— WEB-3：行内嵌 `<button>` 属非法嵌套，已改 div）→ 弹窗显示 `logs?tail=…` 尾部文本。
- **状态与边界**：只读展示（D50）；Esc 关闭。

### 按钮 · 重启（写操作，D51）

- **前置**：容器名在连接的 `restartAllow` 白名单内 —— 否则**不渲染**该按钮。
- **触发**：二次确认（D31，情境化标题「重启容器『{名}』？」+ 中断提示）→ `POST /api/portainer/restart` → 审计日志（`widget.write-action`）。
- **错误态**：重启失败 → `WbAlert`（原因 + 上下文）。
- **边界**：白名单为空 = 一律无重启入口（留空即禁）。

## 已知问题

见 [../00-issues.md](../00-issues.md)。
