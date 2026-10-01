# 01 · Mihomo 服务概览卡指标重排 + 全组件字号自适应（Q69）

> **Q69 产出**（2026-10-01，走 **D47/08-widget-quality** 门禁）。用户反馈「一、Dashboard 3 / 4」：
> ①「出口选择」块卡片小时**展示不全**（要设最小高度）；②「累计流量」直接分成两个内容块，**正好一行三个**；
> ③「策略组选择」不需要展示，展示节点延迟即可；④ 内存获取失败无需展示，开发期可暂时展示但要留 ToDo，
> 且应**打印错误日志到前端控制台**；⑤ Immich 照片数 / Navidrome 曲目数在卡片过小展示不全 —— 字号随卡片缩小，但要有最大字体。
>
> 真机基线（`https://clash-api.xfdzcoder.space`，meta v1.19.31，第 103/104 轮实测）：
> 出口 `DIRECT` · 策略组 15 · 节点/策略 21 · 活动连接 96 · 累计 `↓35.0 GB · ↑13.9 GB` · 规则 11 · 订阅源 15
> ·「策略组选择」清单 ·「节点延迟」清单 · **可见的「内存获取失败（This operation was aborted）」note**。

## 0 · 用户问题清单（persona = 自托管/家庭服务器拥有者，开卡 5 秒想回答什么）

1. **我现在走的是哪个出口节点？**（一秒都不该被裁掉 —— 主指标，用户反馈的正题）
2. **累计跑了多少钱的流量？下行和上行各多少？**（用户明确要拆开看）
3. **现在有多少活动连接，卡不卡？**（与流量同排看，构成「一行三个」）
4. **我的节点健康吗？哪个延迟高？**（要「节点延迟」清单）
5. ~~内部状态（内存/规则）需要我盯着吗？~~ → 用户明确：**内存不要进 UI**；规则/订阅源计数保留为次指标（不占主要视线）。

## 1 · 对照物调研（留痕）

| 对照物 | 它展示什么 | 结论 |
|---|---|---|
| **metacubexd · Overview 页**（用户点名的参照物，`metacubexd.xfdzcoder.space` 实测） | Connections（活动连接数）、Traffic（实时上下行速率曲线）、**Upload Total 与 Download Total 是两个独立数字块**、Memory 曲线；**不放策略组清单** —— 策略组在独立的 Proxies 页 | ① **累计上下行拆成两块**是该产品的既定做法，与用户要求一致；② 策略组清单不属 Overview，属 Proxies 页 —— 我们的「Mihomo 节点面板」组件正是那一层职责，概览卡应让位 |
| **mihomo `external-controller` API**（meta v1.19.31） | `/connections` → `downloadTotal`/`uploadTotal`/`connections[]`；`/memory` → `inuse`；`/proxies` → 组 `now` + 节点/组 `history` 尾点延迟 | 三块数据源齐备，无需新增接口 |
| **Homarr**（Health Monitoring 卡） | CPU / 内存 / 磁盘，不对接 mihomo | 无可比项；其「一个卡片一件事、大数字」的排布风格可参考 |

**结论**：用户要求的形态与 metacubexd Overview 一致，且把「策略组清单」下放到节点面板组件更符合职责划分。

## 2 · 指标映射表（四列）

| 用户问题 | 指标 | 数据来源（接口） | 取不到时的降级 |
|---|---|---|---|
| 我走哪个出口？ | **出口选择**（主指标，emphasis） | `GET /proxies` → `proxies.GLOBAL.now`，回落首个策略组的 `now` | 组信息缺失 → 值 `—`，note「无法读取策略组（<原因>）—— 检查 external-controller 密钥与 `/proxies` 访问」 |
| 累计下行多少？ | **累计下行**（次指标，独立一块） | `GET /connections` → `downloadTotal` | `/connections` 失败 → 该块不渲染，note「累计流量获取失败（<原因>）—— 检查 external-controller 密钥；经反代部署时 `/connections` 可能超时，可直连」 |
| 累计上行多少？ | **累计上行**（次指标，独立一块） | `GET /connections` → `uploadTotal` | 同上 |
| 现在多少活动连接？ | **活动连接**（次指标） | `GET /connections` → `connections.length` | 同上 |
| 节点健康吗？ | **节点延迟**（清单） | `GET /proxies` → 组/节点 `history` 尾点 `delay` | 无 `history` → 该项不列出（**不是错误**，不写 note） |
| 规则/订阅源多少？ | **规则数 / 订阅源数**（次指标） | `GET /providers/rules` → `ruleCount` 求和；`GET /providers/proxies` → `providers` 键数 | 失败 → 对应块不渲染，note 带原因+怎么修 |
| 内存还正常吗？ | **内存**（次指标，仅在能取到时渲染） | `GET /memory` → `inuse` | 失败 → **不进卡片**，进 `ServiceOverview.diagnostics`，前端 `console.error` 打印。开发期保留该诊断通道，稳定后清理（已记 07 ToDo） |

**与 D48「次指标 2–4」的偏离说明**：本卡次指标 6 个（节点/策略、活动连接、累计下行、累计上行、规则、订阅源）。
用户明确要求「累计流量拆两块 + 正好一行三个」，故采用 **3 列网格**排成 2 行 × 3，视觉上仍是两组整齐的三联块。
D48 的 2–4 是通用建议，此处按用户显式指令执行并留痕。

## 3 · API 落实

- **无新增接口**：三个数据源（`/proxies`、`/connections`、`/providers/*`、`/memory`）connector 已聚合（`connector/service.ts` 的 `normalizeMihomo`）。
- **多接口失败隔离**：`best()` 已把各接口失败降级为 `errors[]` → 逐条 note，不整卡空白（08 §5）。
- **权限模型**：external-controller 用 `Authorization: Bearer <secret>`；`/memory` 在部分反代下被缓冲或挂起（实测 `This operation was aborted`）→ 这正是「内存不进 UI」的现实依据。

## 4 · 展示形态改动

| 位置 | 改动 |
|---|---|
| 次指标网格 | 新增 `.wb-metric-grid--3`：`grid-template-columns: repeat(3, minmax(0,1fr))`，窄卡经 container query 降为 1 列 |
| 出口选择（主指标） | `.wb-metric--primary` 设 `min-height` + 值 `nowrap` + 省略号 —— 保证卡片再小也不被裁切 |
| 全组件字号 | `.wb-metric` 开 `container-type: inline-size`，值字号 `clamp(min, cqw, max)`：随卡片缩放、**上限 `--wb-text-display`（32px）**、下限保可读 |
| 内存降级 | `ServiceOverview` 契约新增 `diagnostics?: string[]`（**只进开发者控制台，不渲染**），前端 `console.error` 输出；内存指标本身在取到时仍渲染 |

## 5 · 降级文案自检（08 §5）

- ✅ 全部写「原因 + 怎么修」，无「该服务未提供 X」式甩锅。
- ✅ 内存一项按用户指令**移出 UI**，但错误仍进 `console.error`（开发期可查），并记 ToDo 后续清理。
- ✅ 单接口失败不整卡空白（`best()` 隔离 + 逐条 note）。

## 6 · 真机验证

见 07 第 106 轮记录：`verify-live` 断言主指标 `DIRECT` 与真机一致、累计流量拆两块、无「策略组选择」清单、
有「节点延迟」清单、卡片不含「内存获取失败」文本、且浏览器 console 收到该诊断。
