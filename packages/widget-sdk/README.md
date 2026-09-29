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
- 刷新：宿主按 `refresh.defaultRefreshSec` 轮询 + SSE 失效通知（FR-I6）；
  `minRefreshSec` 是防打爆第三方的下限（NFR4）。

## 动作（FR-I5）

`ActionDispatcher`（`dispatch(action, params)`）→ 服务端统一执行，
权限/审计/限流集中处理。动作能力须在 `capabilities.actions` 声明。

## 生命周期（FR-W4）

宿主向组件注入 `WidgetProps`：`config / data / refresh / dispatch / widgetId`。
组件只消费数据、派发动作；加载/错误态由 `WidgetDataState` 表达。
**配置变更**由宿主提供：编辑态每个实例带「配置」入口（WidgetChrome），
按 manifest 的 configSchema 打开表单、改后写回布局 JSON —— 组件实现零感知。

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
- **加载与沙箱（FR-W7）**：宿主在隔离环境渲染插件（iframe CSP / Web Component，落地选型随运行时实现记录决策）；越权调用由宿主按白名单拒绝。
- **生命周期（FR-W6）**：上传 → 校验 → 启用 / 禁用 / 卸载；`apiVersion` 主版本与宿主不一致的插件拒绝启用。

---

## 测试

`pnpm test` —— 契约测试（manifest 校验、configSchema 校验、SecretRef 判定）。
内置组件（todo / custom-api）即规范的可运行样例（J8）。
