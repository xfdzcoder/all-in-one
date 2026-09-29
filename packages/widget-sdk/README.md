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

## 未来第三方插件（D7 二期）

本契约即插件 ABI：manifest 可序列化为 JSON（插件包内 `manifest.json`），
运行时校验用 `validateManifest()` / `validateConfigSchema()`；
安装器（FR-W6）与沙箱属二期范围。

---

## 测试

`pnpm test` —— 契约测试（manifest 校验、configSchema 校验、SecretRef 判定）。
内置组件（todo / custom-api）即规范的可运行样例（J8）。
