# MVP 定义（任务 3）

> 状态：**定稿**（2026-09-28 确认）。技术方案见 [04-tech-stack.md](04-tech-stack.md)；范围基线见 [01-requirements.md](01-requirements.md)。

## 1. MVP 目标与假设

验证**核心架构假设**，而非堆功能：

1. 多 Dashboard 页面 + 布局引擎（拖拽/缩放/断点重排/持久化）；
2. Widget 统一契约（manifest/configSchema/生命周期/数据通道）成立——"新增组件不改核心"（J8）；
3. 数据/视图分离真实可用（J4）；
4. 数据型组件与可交互组件各至少一个；
5. 移动端浏览+操作路径可用（D2/D10 边界内）。

假设：D1–D14 成立；单机 Docker Compose；个人数据规模。

## 2. 里程碑切分

### M0 · Spike：布局引擎验证（1–2 天，先行）

| 项 | 内容 |
|---|---|
| 交付物 | 最小页面挂接 gridstack React wrapper：鼠标拖拽、缩放、断点自动重排、布局 JSON save/load；**结论写入 02-decisions.md** |
| 验收 | 4 项能力全通过 → 保留 gridstack；任一关键能力不可行 → 按 D12 预案切 react-grid-layout（预留 1 天切换余量） |
| 对应决策 | D12 |
| **状态** | ✅ **完成（2026-09-28）**：gridstack v14，自动化验证 7/7 通过（渲染/保存/拖拽/缩放/断点 12↔2 列/恢复/位置一致），结论记入 D12 |

### M1 · 骨架与持久化

| 项 | 内容 |
|---|---|
| 交付物 | ① pnpm monorepo（`apps/web` / `apps/server` / `packages/widget-sdk` 占位）② Fastify + Drizzle + SQLite schema（`user` / `dashboard` / widget 布局 JSON + `schemaVersion` + 归属字段，对齐 NFR5）③ 账号初始化 + argon2id + Cookie 会话（SEC1/SEC2）④ Dashboard CRUD/排序 ⑤ 布局引擎接入（按 M0 结论）、编辑/浏览模式分离（FR-P8）、防抖自动保存、刷新恢复、默认布局兜底（FR-P4）⑥ 移动端隐藏编辑入口（FR-P7） |
| 验收 | **J1**（部署→初始化→登录→默认首页）、**J2**（编辑→拖拽→保存→恢复）；组件暂用占位件验证框架 |
| 对应需求 | FR-P1~P8、SEC1/2、NFR5 |
| **状态** | 🔄 进行中：**M1-① ✅** 三包齐备；**M1-② ✅** Fastify+Drizzle+SQLite(WAL) schema（D16）；**M1-③ ✅**（2026-09-28）首启建账号 + argon2id + httpOnly Cookie 会话（`session` 表带 `user_id`，SEC1/SEC2）；**M1-④–⑥ 待做** |

### M2 · Widget 契约 + 数据通道 + 首批组件

| 项 | 内容 |
|---|---|
| 交付物 | ① `widget-sdk` 契约包：manifest、configSchema→表单生成、生命周期、能力声明（data/refresh/action）② 后端统一数据通道：服务端代取/缓存/限流/刷新调度 + SSE 失效通知（FR-W3/I3/I6）③ Credential Store（AES-256-GCM，主密钥环境变量注入，SEC3）+ secret 引用式配置 ④ SSRF 基线（内网目标默认拒绝，SEC4）⑤ **Todo 组件**（Workspace 级数据、勾选完成/新增、清单过滤配置）⑥ **自定义 API 组件**（D14 声明式模板 + Raw JSON 兜底）⑦ widget-sdk 契约测试（Vitest） |
| 验收 | **J4**（双页面 Todo 同步）、**J5**（自定义 API 含鉴权）、**J8**（规范文档 + 内置组件按规范实现即为样例） |
| 对应需求 | FR-W1~W5/7、FR-I1~I5、SEC3/4/5 |

### M3 · 组件补齐 + 移动端收口 + 部署

| 项 | 内容 |
|---|---|
| 交付物 | ① **RSS 组件**（多源/摘要/未读标记归 Workspace/跳转原文）② **应用入口+状态组件**（HTTP/TCP 探测、跳转）③ **iframe Widget**（sandbox 属性 + CSP + 禁嵌明确提示）④ 移动端验收：375px 路径可用、触控目标 ≥44px（NFR2）⑤ Playwright 旅程测试 J1–J4 ⑥ 单镜像 Docker + docker-compose、备份/恢复说明、健康检查、结构化日志脱敏（NFR1/NFR6） |
| 验收 | **J3/J6/J7**；**J1–J8 全绿 = MVP 出口** |
| 对应需求 | §2.3 首版组件全部、SEC5、NFR1/2/6 |

## 3. 验收映射总表

| 旅程 | 里程碑 | 旅程 | 里程碑 |
|---|---|---|---|
| J1 首次部署引导 | M1 | J5 自定义 API+鉴权 | M2 |
| J2 布局持久化闭环 | M1 | J6 应用入口+状态 | M3 |
| J3 移动端完整可用 | M3 | J7 iframe/禁嵌提示 | M3 |
| J4 数据/视图分离 | M2 | J8 扩展机制验证 | M2 |

## 4. MVP 范围外

即 01 §1.2 非目标 + §2.3 排后组件：Kanban、邮件、监控、OpenCode 组件；代码插件安装器（FR-W5 ③）；多用户/公网安全项（SEC6）；布局导入导出；组件联动；Gmail API 专项。

## 5. 任务 5 收口

[06-roadmap.md](06-roadmap.md) 待定清单 5 项**均不阻塞 MVP**，决策时机已排（M2/M3/二期/排期时）。MVP 期间如触碰 Todo 数据模型、RSS 源管理形态，以开发期简决为准并回写决策日志。

## 6. 出口标准（Definition of Done）

- [ ] J1–J8 全部通过（Playwright 覆盖 J1–J4，其余旅程手工验收记录，D15）
- [ ] SEC1/3/4/5 落地自检通过（凭证不落前端/日志、SSRF 拒绝内网、iframe 沙箱生效）
- [x] D12 spike 结论已定并记录（✅ 保留 gridstack，见 D12）
- [ ] `docker compose up` 可部署 + 备份/恢复演练
- [ ] 文档同步（05 定稿、06 更新、决策日志无缺口）

## 7. 已确认的范围决议（D15）

- **M2/M3 边界**：RSS 组件放 M3；M2 聚焦契约 + Todo + 自定义 API 打深。
- **测试门槛**：MVP 出口 = Playwright J1–J4 全绿 + J5–J8 手工验收脚本化记录。
