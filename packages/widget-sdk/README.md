# @all-in-one/widget-sdk

Widget 契约包 —— 宿主（apps/web / apps/server）与所有 Widget 之间的**唯一契约来源**
（D4/D7 的落地物）。内置组件与未来第三方插件共用同一套规范。

**边界纪律**：本包不得反向依赖 apps；布局引擎（gridstack）不得泄漏进本包。

---

## Widget 扩展规范（J8 样本文档）

新增一个组件**不修改核心代码**，只需三步：

### 1. 声明 Manifest（FR-W1）

```ts
import type { WidgetManifest } from "@all-in-one/widget-sdk";

export const myManifest: WidgetManifest = {
  type: "my-widget",              // 全局唯一 id（gridstack component key）
  name: "我的组件",
  category: "数据",
  defaultSize: { w: 4, h: 3 },     // gridstack 格子单位
  minSize: { w: 2, h: 2 },
  configSchema: [/* ConfigField[] 见下 */],
  capabilities: {
    data: { source: "http-connector" },   // workspace | http-connector | none
    refresh: { minRefreshSec: 30, defaultRefreshSec: 300, supportsManualRefresh: true },
    actions: [{ name: "my.action", label: "执行" }],
    detail: true,
  },
};
```

### 2. 声明配置表单（FR-W2，宿主自动生成表单）

```ts
configSchema: [
  { key: "url", label: "接口地址", type: "text", required: true },
  { key: "mode", label: "模式", type: "select", default: "a",
    options: [{ value: "a", label: "A" }] },
  { key: "token", label: "令牌", type: "secret" },   // 明文入库凭证库，配置只存引用（SEC3）
]
```

字段类型：`text | number | boolean | select | json | secret`。
`secret` 字段的值永远是 `{ credentialRef: string }`，明文只在服务端 connector 内解密。

**标准字段（宿主自动附加）**：manifest 声明 `capabilities.refresh` 时，表单尾部自动
出现「刷新频率（秒）」（存 `props.refreshSec`，下限 = `minRefreshSec`，留空 = 用
`defaultRefreshSec`）——组件**不要**在 configSchema 里重复声明。

### 3. 实现组件并注册

```tsx
function MyWidget(props: MyConfig) {
  const { data, loading, error, refresh } = useCustomApiData(props);
  // 或走工作台 REST（workspace 数据，参考 TodoWidget）
  return …;
}

// widget-registry.ts
export const widgetComponents = { …, "my-widget": MyWidget };
export const builtinManifests  = […, myManifest];
```

**完成。** 数据通道（缓存/限流/SSE）、SSRF 防护、凭证注入、配置表单全部由宿主提供。

---

## 数据通道（FR-W3）

- Widget **不直连第三方**。`data.source` 决定取数方式：
  - `workspace`：工作台自身 REST（如 Todo）；
  - `http-connector`：服务端代取（POST `/api/widgets/data`，SSRF 基线 + 凭证注入 + 缓存限流）；
  - `none`：无数据源（纯展示）。
- 刷新（FR-I3）：**定时**——`props.refreshSec`（FR-I2 标准字段）优先，否则
  `refresh.defaultRefreshSec`；`minRefreshSec` 是防打爆第三方的下限（NFR4）。
  **手动**——组件头部「刷新」按钮强制回源（数据通道 `force` 穿透服务端 TTL 缓存）；
  SSE 不可用时宿主另有断线轮询兜底（FR-I6）。

## 动作（FR-I5）

`ActionDispatcher`（`dispatch(action, params)`）→ 服务端统一执行，
权限/审计/限流集中处理。动作能力须在 `capabilities.actions` 声明。

## 生命周期（FR-W4）

宿主向组件注入 `WidgetProps`：`config / data / refresh / dispatch / widgetId`。
组件只消费数据、派发动作；加载/错误态由 `WidgetDataState` 表达。
**配置变更**由宿主提供：编辑态每个实例带「配置」入口（WidgetChrome），
按 manifest 的 configSchema 打开表单、改后写回布局 JSON —— 组件实现零感知。

**宿主服务**（`WidgetEditContext`，D28）：`editMode`（是否编辑态）、`onConfigure(id)`、
`requestSave()` —— 组件把"视图选择"沉淀为配置时，写回自身节点 props 后调用
`requestSave()` 触发布局持久化（Workspace 数据仍走 REST/SSE，不进 props）。

**详情（FR-I4）**：`capabilities.detail: true` 由组件**自行**提供详情弹层
（条目点击 → Modal/Drawer）；宿主不提供通用详情 UI。摘要/正文等不可信 HTML
一律用 `HtmlSandbox`（deny-all iframe + CSP 禁脚本）渲染。

**破坏性操作（D34）**：删除/退订/卸载一律二次确认（宿主 `ConfirmAction`，弹窗点名
目标并说明数据边界）；唯一豁免 = 布局编辑内的组件移除。

## 插件 ABI（FR-W5③ / FR-W6 / FR-W7，D7 契约先行）

代码级插件与内置组件共用上面的 Widget 契约；插件额外带 `plugin` 块
（`PluginManifest`，安装/加载前用 `validatePluginManifest()` 校验）：

```jsonc
{
  "type": "hello-plugin",
  "name": "Hello 插件",
  "defaultSize": { "w": 4, "h": 3 },
  "configSchema": [/* ConfigField[]，同上 */],
  "capabilities": { "data": { "source": "http-connector" } },
  "plugin": {
    "entry": "dist/widget.js",   // 包内相对 ESM 模块路径（禁绝对路径 / `..` 穿越）
    "apiVersion": "1.0.0",       // 宿主 ABI 版本（semver，主版本须一致才可启用）
    "permissions": {              // FR-W7 显式白名单，缺省 = 最小权限
      "apis": ["widgets.data"],
      "credentialKinds": ["http-header"],
      "actions": []
    }
  }
}
```

- **包格式**：zip = `manifest.json` + `entry` 模块（ESM，导出 `WidgetComponent`）+ 可选资源。
- **信任模型（K7）**：仅管理员安装（FR-W6）；权限显式声明、默认最小化 —— 未声明即不可调用宿主 API、不可引用凭证、不可派发动作；数据一律走宿主统一数据通道（FR-W3），插件不直连第三方、不持有凭证明文。
- **加载与沙箱（FR-W7 / D25）**：宿主以 **iframe sandbox（`allow-scripts`，不透明源）+ CSP（`connect-src 'none'` 等）** 隔离加载（D25 否决 Web Component —— Shadow DOM 只隔离样式不隔离 JS）；入口模块经 data: URL 在框内 `import()`（**自包含，禁止 import 外部模块**），源码永不进入宿主作用域；越权调用由宿主按白名单拒绝。
- **运行时 ABI（D25）**：入口默认导出 `render(props, ctx)`；`props = { config, data }`，`ctx = { root, onAction(name, params), onResize(height), onError(err) }`；宿主↔插件只交换结构化 postMessage。
- **数据桥（FR-W3 / D26）**：插件数据走宿主统一数据通道（`type` = 插件 type）；v1 数据源 `http-connector`（config 键沿用约定：url / apiToken / authHeader / headers / method / body）或 `none`；取数须 `permissions.apis` 含 `"widgets.data"`；secret 字段的凭证件 kind 须列入 `permissions.credentialKinds`，明文只在服务端解密。
- **动作（FR-I5 / D27）**：`ctx.onAction(name, params)` 经桥到宿主；`name` 须在 `permissions.actions` 白名单内；由**服务端固定 registry** 执行（v1：`todo.create` / `todo.toggle` / `feed.markRead`，参数 zod 校验），每次执行记结构化审计日志（参数不入日志）。
- **生命周期（FR-W6）**：上传 → 校验 → 启用 / 禁用 / 卸载；`apiVersion` 主版本与宿主（`HOST_API_VERSION`）不一致的插件拒绝启用。

---

## 测试

`pnpm test` —— 契约测试（manifest 校验、configSchema 校验、SecretRef 判定）。
内置组件（todo / custom-api）即规范的可运行样例（J8）。
