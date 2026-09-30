# 组件 · OpenCode

> 层级：页面 → 组件 → 按钮。约定见 [../README.md](../README.md)；问题见 [../00-issues.md](../00-issues.md)。
> FR-E4：对接 opencode server HTTP API（experimental，**D32**：直接 HTTP 薄封装 + API 版本探测容错）。

**截图**：![组件特写](../assets/c-opencode.png)

## 配置（configSchema）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `url` | text（必填） | — | opencode server 地址（`http://127.0.0.1:4096`） |
| `apiToken` | secret | — | 访问令牌（入凭证库 SEC3，配置仅存引用） |
| `limit` | number | 20 | 会话条数 |
| `refreshSec` | number | 60 | ≥10 标准刷新字段 |

## 数据流

```
POST /api/widgets/data { type:"opencode", config:{ url, apiTokenRef, limit } }
  ──► opencode connector：GET /api/... sessions + 版本探测
      响应形状变更 → probe.error 显式提示（不空白）
```

## 结构

| 区块 | 内容 |
|---|---|
| 头部 | 「OpenCode 会话」+ 连接徽标 +「刷新」 |
| 会话卡 | 名称 / 状态 / 耗时 /「更新于 {相对时间}」 |
| 弹层 | 会话详情（FR-I4） |

## 交互点

### 徽标 · 连接状态

- **绿** `v{版本}`（探测成功）/ 绿「已连接」（无版本号）/ **红**「探测失败」。
- **探测失败时**：黄色 `WbAlert`：「无法读取 opencode API：{原因}（实验性接口，版本不兼容时会在此提示）」——D32 显式提示原则。

### 按钮 · 刷新

- **触发**：force 回源。

### 会话卡（点击开详情）

- **逐步行为**：点击 → 详情弹窗：名称 / 状态 / 创建 · 更新（相对时间）。
- **状态与边界**：⚠ ISS-19（卡片键盘不可达）；详情信息量少（无会话日志/任务列表）——P2 级体验观察。

## 状态与边界

| 状态 | 表现 |
|---|---|
| 未配 url | 「配置后显示 opencode 会话」 |
| 探测中 | 「探测中…」 |
| 空态 | 「暂无会话」 |
| 错误 | 红色 `WbAlert` |

## 已知问题

⚠ ISS-19（逻辑 P2）卡片键盘不可达
