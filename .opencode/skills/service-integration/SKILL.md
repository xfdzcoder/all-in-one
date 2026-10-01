---
name: service-integration
description: 接入第三方服务/新增数据卡片组件时使用。编码 08-widget-quality 质量门禁流程（用户问题→对照→指标→API→降级→真机验证），防止"API 给什么展示什么"的 demo 级指标。凡 Immich/Navidrome/Portainer/Mihomo 等服务接入、connector 适配器、卡片指标改动都应走此流程。
---

# 接入新服务 / 新指标的强制流程（D47 质量门禁）

本 skill 是 `docs/feature-plan/08-widget-quality.md` 的执行版。**核心原则：先写用户问题，再定指标，再选 API。**

## 第 0 步 · 用户问题清单（3–5 条）

persona = 自托管/家庭服务器拥有者。打开卡片 5 秒内想回答什么？写成问句。例（Portainer）：
"我的容器都活着吗？哪些炸了？环境多大？最近发生了什么？"
**没有这一步不许看 API 文档。**

## 第 1 步 · 对照物调研（留痕）

- 目标服务**官方 UI** 展示什么（admin 页/首页）；
- 至少一个成熟 dashboard（Homarr / Homepage / Grafana）对同一服务的 widget 字段。
- 结论写进 `docs/feature-plan/research/`（新调研追加新文件，不改旧结论）。

## 第 2 步 · 指标映射表（四列缺一不可）

`用户问题 → 指标 → 数据来源（接口）→ 取不到时的降级`

## 第 3 步 · API 落实（真机探测优先）

- **先连真实实例探测再写代码**。凭证模式：只放 `.opencode/.env.verify`（`.env.*` 已 gitignore），脚本从环境变量读；**不入库、不入日志、不进前端**，用后提醒用户轮换。
- 探测要点：枚举候选路由（服务版本间路由会整体搬迁，如 Immich `/api/statistics` → `/api/server/statistics`）；摸清**权限模型**（细粒度 API Key 的 scope，403 ≠ 服务没有此数据）；注意反代会破坏流式/慢接口（mihomo `/traffic` 被缓冲、`/memory` 挂起 → 改 `/connections` 差分）。
- 单接口 404 不许整卡空白：**多接口聚合 + 多版本回落**（官方统计接口缺失就用其它接口聚合出等价指标，如 Navidrome 用 `getScanStatus`+`getArtists` 顶替不存在的 `getStats`）。

## 第 4 步 · 契约与展示（D48）

- 契约先行（D7）：`ServiceOverview` 结构化 = 主指标（1）/ 次指标（2–4）/ 状态徽标 / 清单（异常·最近·正在发生）/ 迷你趋势序列。
- 数字带单位与语义（`95.2 GB`、`23/25 运行中`）；相对时间悬浮绝对；异常清单置顶高亮；全健康给绿态一句话，不留空。
- 趋势：客户端累积轮询序列；速率类用累计量差分。

## 第 5 步 · 降级文案（硬规则）

写**原因 + 怎么修**。对：`API Key 缺 server.statistics 权限（Immich 后台→账号→API Key 勾选）`。
错：`该服务未提供计数指标`（把开发者调错接口的锅甩给服务）。

## 第 6 步 · 验证与完成定义（DoD）

- 契约测试覆盖归一逻辑与**每条降级分支**；
- **真机验证**：连真实实例看卡片，主指标与官方 UI 对得上、降级文案真实、无整卡空白。拿不到实例 → 标"待真机验证"入 07 待办，**不勾完成**；
- UI 行为有 `apps/web/scripts/verify-*.mjs` 断言（改 web 后必须重建 bundle 再测）；
- `pnpm test` / `typecheck` / `lint` 全绿；
- 08 §5 DoD 清单勾全、自检结果写入 07 当轮记录，然后才提交（英文 conventional commits，不 push）。

## 历史教训（禁止再犯）

| 反模式 | 出处 |
|---|---|
| API 给什么展示什么 | Q39 四服务指标（用户批"demo 级"） |
| 取不到写"服务未提供" | Q39 Immich/Navidrome（实为调错路由/接口不存在） |
| 单接口 404 整卡空白 | Q39 Immich |
| 只 mock 不真机 | Q39 四服务（对比 Q37 Glances 连了真机就好） |
| 贫血契约将就 | Q39 `stats[]`（→ D48） |
| 流式/慢接口无降级 | mihomo `/traffic`、`/memory` |
