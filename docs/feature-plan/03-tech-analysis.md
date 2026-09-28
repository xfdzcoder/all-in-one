# 关键技术问题分析（任务 2）

> 本文是**方案对比过程文档**，结论见 [04-tech-stack.md](04-tech-stack.md)。对应决策 D11–D14。

## K1. 自由拖拽/调整大小 + 移动端适配（最大选型风险点）

| 方案 | 优点 | 缺点/风险 |
|---|---|---|
| **gridstack.js**（v13，官方 React wrapper） | 原生触摸事件（v6+）；断点列数响应；save/load 原生；零依赖；**Homarr 生产验证（其 fork 即此库）**；活跃维护 | 各断点共享一套布局（"per column layouts"官方 TBD）——被 D6 化解；官方 React wrapper 较新 → spike 验证 |
| **react-grid-layout** | 原生支持每断点独立布局（lg/md/sm/xs）；React 生态久经考验 | 触摸支持弱（D10 后非需求）；维护节奏放缓；仅 React |
| interact.js / dnd-kit + 自研网格 | 手势控制力最强 | 违背"避免重复造轮子"，碰撞/推挤算法自研成本高，**不采用** |

**收敛过程：**
- D6（单一布局自动重排）：消除 RGL"每断点独立布局"优势，两候选差距收窄；
- D10（手机禁止编辑）：消除触摸拖拽需求，两候选触摸能力均无关紧要；
- 结论（D12）：gridstack 优先（save/load 原生 + dashboard 专建 + Homarr 先例），RGL 既定备选；MVP 首里程碑 spike（拖拽/缩放/断点/保存）不合格即切换。

**残余风险：** 嵌套拖拽手势冲突（二期 Kanban 卡片拖动 vs 网格拖动）需专门设计；布局引擎必须封装在 `apps/web` 内部，**不泄漏进 widget-sdk 契约**（保留更换自由）。

## K2. 多页面与布局持久化

- **数据模型：** `page` 表 + 布局 JSON（按 widget 存 x/y/w/h + config）。JSON 文档式（每页一列）vs 规范化表（每 widget 一行）。
  - 个人规模下 JSON 文档足够、迭代快；规范化便于未来多用户查询/权限过滤。
  - **折中：** JSON 存储 + 顶层 `schemaVersion` + 归属字段（对齐 NFR5/D9）。
- **保存时机：** 拖拽结束防抖自动保存（推荐）vs 显式保存按钮。单用户冲突风险低；需处理保存失败回滚。
- **风险：** 布局 schema 演进（组件配置字段变更）必须有迁移策略，否则升级丢布局 → `schemaVersion` 强制。

## K3. Widget 统一抽象与运行机制

- **契约：** Manifest（元数据 + configSchema + 能力声明 `data`/`refresh`/`action`/`detail`）+ 渲染入口。
- **运行机制三档（FR-W5 / D7）：**
  1. **内置组件**：构建时打包，能力最强，需发版更新；
  2. **零代码组件**：iframe Widget、自定义 API Widget（URL + 鉴权 + 展示模板；Homarr "Custom Widgets" 同思路）；
  3. **代码级插件**：运行时加载 JS bundle / Web Component。最大安全面，必须权限声明 + 沙箱 + 管理员安装——**首版仅定义契约，安装器二期**。
- **数据获取归属：** **宿主统一调度**（声明数据源 → 后端代理 → 前端缓存/刷新），组件不自理请求。好处：凭证不出后端、统一限流缓存、插件无权直连；代价：数据形态需标准化。
- **风险：** 插件机制过度设计 → 契约先行、实现分层；内置组件即"第一个插件"（J8 验证）。

## K4. Widget 配置、数据请求和操作接口

- **配置：** JSON Schema（zod → JSON Schema）驱动表单生成；敏感字段标记 `secret`（存 Credential Store，配置只存引用）。
- **数据：** `GET /api/dashboards/:id/widgets/:wid/data`（服务端按 manifest 适配器取数、缓存）；刷新 = manifest 声明 interval + 前端 TanStack Query；实时用 SSE。
- **操作：** `POST .../actions/:action`，能力由 manifest 声明（如 `todo.complete`）。
- **风险：** 接口过度通用化会变成"第二套 GraphQL"；保持 manifest 声明式 + 适配器内自由实现的平衡。

## K5. 第三方服务集成方式

- **统一模式：** Credential Store + Server-side Connector + 统一错误/超时/限流/缓存。前端永不直连第三方。
- **邮件（只读，排后）：** IMAP 轮询 → 服务端缓存索引 → 前端分页读取。难点：HTML 邮件严格消毒（XSS）、多账号连接管理、附件预览（可后置）、全文搜索（可后置）。最佳库 imapflow（Node）。
- **OpenCode（排后）：** 已验证存在实验性 HTTP API（session list/active/stats/interrupt + event stream）与官方 `@opencode-ai/sdk`。**可行**；风险：API 标注 experimental、版本锁定、多实例、basic auth 凭证管理。建议薄封装 + 版本探测。
- **监控（排后）：** 数据来源三选一：Prometheus node-exporter（生态标准，重）、轻量 agent/后端直采系统指标（轻）、SSH 采集（不采用）。来源未定，排期时定。
- **iframe Widget：** 目标站 `X-Frame-Options`/`CSP frame-ancestors` 禁止嵌入时无解（Portainer 等可配置放行）；组件需明确提示此限制。

## K6. 前后端职责边界

- **前端：** SPA（布局引擎、Widget 渲染、配置表单、交互）。**不做 SSR**（登录墙 + 无 SEO）。
- **后端单体：** REST API、鉴权、Connector 层、Credential Store、定时任务调度、数据缓存、插件注册与（未来）插件静态托管。
- **边界铁律：** 凭证与第三方出站请求全部在后端；前端只消费工作台 API。
- **风险：** 避免 BFF 过度碎片化；Widget 数据接口宁可聚合也不要一组件一协议。

## K7. 自定义组件扩展机制（D4/D7）

- **规范包：** `packages/widget-sdk`：manifest 类型 + configSchema 约定 + 生命周期接口 + 渲染 props 契约；内置组件也按它实现。
- **分发/安装：** 首版"构建时注册 + 零代码组件"即可；二期管理页上传 → 校验 → 启用；npm registry/商店【暂不考虑】。
- **信任模型：** 仅管理员可安装；插件权限显式声明、默认最小化；Web Component/iframe 沙箱隔离样式与脚本。
- **风险：** 与"未来公网"叠加后第三方插件 = 最大攻击面。**强烈建议二期插件仍仅限前端渲染 + 宿主统一数据通道**，服务端 connector 插件（后端执行第三方代码）最后考虑。

## K8. 复杂组件实现难点小结

| 组件 | 难点 | 结论 |
|---|---|---|
| 邮件 | HTML 消毒、多账号 IMAP、缓存索引 | 只读（D3）后可行，仍是工作量最大的 connector；排后 |
| OpenCode | API 实验性、版本绑定 | 可行性已验证（HTTP API + SDK）；薄封装 + 版本探测；排后 |
| Kanban | 嵌套拖拽手势、数据模型、多项目 | 可做，但与 K1 布局拖拽冲突需专门设计；排后 |
| 监控 | 数据来源未定 | 先定来源再排期 |
| iframe | 目标站禁嵌、移动端体验 | 官方内置零代码组件，能力边界向用户说清；进首版 |
