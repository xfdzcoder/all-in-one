# 质量体检 · 总结与修复批次映射

> 来源：[README.md](README.md)。**状态：✅ 汇总完成（2026-10-02，Q95）**。
> 产出四件套：本文件 + [`00-issues.md`](00-issues.md)（台账/批次工作单）+ `10–15-*.md`（6 份分域报告，146 条 + 存疑 8 条）+ [`01-static-scan.md`](01-static-scan.md)（静态检测器现状）。

## 1 · 分域报告与条目统计

| 报告 | 范围 | P0 | P1 | P2 | 小计 | 最值得警惕 |
|---|---|---|---|---|---|---|
| [10-server.md](10-server.md) | apps/server | **2** | 10 | 17 | 29 | SRV-01 SSRF 可绕（IPv4-mapped IPv6）、SRV-02 静态目录穿越、SRV-03/SEC-5 缓存键碰撞 |
| [11-web.md](11-web.md) | apps/web | 0 | 10 | 20 | 30 | WEB-2 字段无法清空（`restartAllow` 残留=「禁重启」失效）、WEB-3 嵌套 button、WEB-8 缩略图缓存 churn |
| [12-sdk-contracts.md](12-sdk-contracts.md) | widget-sdk + 契约 | 0 | 6 | 17 | 23 | CON-1 OpenAPI 仅 9/≈64 操作（契约基准名存实亡）、CON-4 dist 无重建守卫、SDK-1 `null` 崩溃 |
| [13-tests-verify.md](13-tests-verify.md) | 测试 + verify | **1** | 8 | 14 | 23 | TST-19 verify 覆写真机布局不还原、TST-21 创建数据源/凭证零清理、TST-11 写死快照假红 |
| [14-deps-security-lint.md](14-deps-security-lint.md) | 依赖/安全/lint | 0 | 5 | 8 | 13 | SEC-1 `isPrivateIp` 漏项、SEC-4 报错文案泄漏完整内网 URL、DEP-2 gridstack `^14.0.0` 与补丁精确版本错配 |
| [15-docs.md](15-docs.md) | 文档全库 | 0 | 2 | 26 | 28 | DOC-1 D55 补记称「已落地」不实（ECharts/WS 未开工）、DOC-2 compose 不透传致文档照做无效 |
| （已定项） | ⑭⑮ | 0 | 1 | 1 | 2 | QA-001 mime 硬编码 / QA-002 `minCell`→`rowHeight` |
| **合计** | | **3** | **41+1** | **102+1** | **148** | |

## 2 · 总体判断

- **安全面有真窟窿**：SSRF 基线两处绕过口径（SRV-01 十六进制 IPv4-mapped、SEC-1 IPv6 link-local/CGNAT 漏项）、静态资源路径穿越（SRV-02，单镜像部署默认开启）、自定义图标 GET 越权（SRV-09/CON-11）——**P0 批必须先修**。
- **数据正确性**：缓存键碰撞（SRV-03/SEC-5，同源两处报告互证）可把 A 配置的 60s 缓存数据回给 B；编辑连接「留空=不生效」（WEB-2）连带 Portainer 重启白名单残留。
- **测试/验收基建是最大薄弱面**：web 43 文件零单测、`mail/imap.ts` 零测试、12 个降级分支仅 2 条断言；verify 脚本写死快照、清理只走成功路径、数据源/凭证零清理（⑬ 实锤）。
- **契约面名存实亡**：OpenAPI 只覆盖 9 个操作，前端 `api.ts` 手写无对账（CON-1/2/3）。
- **文档**：26 条 P2 多为 interaction 教程落后 UI 演进；D55 补记不实需改（DOC-1）。
- 静态检测：oxlint 规则已开足（1100+ warning 分类入册，见 `01-static-scan.md`）；knip 待引入；`pnpm audit` 仅 1 条 moderate（esbuild，dev 链）；gridstack 补丁仍必要、未过期。

## 3 · 修复批次映射（→ 07 队列；P0 先行，每批一次 commit、门禁全绿即 push）

| 批次 | 主题 | 覆盖条目 | 说明 |
|---|---|---|---|
| **Q97** | **P0 安全与数据** | SRV-01、SRV-02、TST-19 | SSRF 判定补严 + 静态伺服加前缀校验 + verify 全面改临时草稿盘自建自删 |
| **Q98** | P1 安全/数据正确性 | SRV-03/04/06/08/09/10、SEC-1/2/4/5、CON-11、WEB-2/5、QA-001、孤儿 credential 核查 | 缓存键/越权/文案泄漏/maxBytes/single-flight/清空语义/mime |
| **Q99** | P1 稳定性与内存 | SRV-05/29、WEB-1/3/4/6/7/8/9/10、SDK-1 | 缓存上限与抓取并发、嵌套 button、错误处理补齐、ErrorBoundary 覆盖、时间格式化崩溃 |
| **Q100** | P1 契约/测试/文档 | CON-1/2/3/4、TST-1/2/5/6/10/11/20/21、SRV-07/11、DOC-1/2、DEP-2 | OpenAPI 补全+对账、测试盲区与弱断言、verify 快照改对账、迁移回滚说明、文档纠偏 |
| **Q96** | lint 收口（与 Q98–Q100 穿插） | LNT-1/2/3 | oxlint 存量清零+豁免细化、knip 引入、pnpm audit 结论落文档 |
| **Q101** | P2 批（按域分小批） | P2×102 + QA-002 | 重复代码/文案/命名/文档过时/`minCell`→`rowHeight` 迁移 |

## 4 · 需用户拍板（已同步 07「待用户确认」）

| 条目 | 取舍点 |
|---|---|
| D10 口径 | 「手机/平板禁止布局编辑」vs 实现 `min-width:768px`：768–1023px 平板竖屏当前**可以**编辑布局 —— 改文档认实现，还是实现改回全禁？ |

## 5 · 修复结果与结论摘要【2026-10-02 收官】

**处置状态**：台账 146 条**逐条处置完毕**（P0 3/3 ✅ · P1 41/41 ✅ · P2 102 全部 ✅ 或「留档渐进」标注，无未处理项）；
存疑 8 条按原判不入台账。修复按拍板顺序落地：前置 4 小项（Q92 统一标题 / Q81·Q83 补验 / Q79 diagnostics 移除）
→ 体检 Q95 → lint 落地 Q96 → **P0**（Q97 SSRF 绕过·静态穿越·布局快照守卫）→ **P1**（Q98 安全数据 → Q99 稳定性 →
Q100 契约/测试/文档）→ **P2**（Q101a 配置键迁移 → Q101b 文档域 → Q101c 代码域/契约/a11y/测试基建/依赖安全）
→ 批 G/H（Q74–Q78：液态填充 / ECharts / 图表组件 / WS 数据源 / 流模式）。**每批独立 commit、门禁全绿即 push（D53）**。

**质量基线（前 → 后）**：

| 面 | 体检时 | 收官 |
|---|---|---|
| 单元/契约测试 | 262（缺 connector http/SDK 校验直测） | **361/361**（+99：回归·契约·降级分支） |
| oxlint 产品侧 | 242 warning（规则集两份空置） | **0**（correctness/suspicious/import/perf 开足 + categories error） |
| knip / `pnpm audit` | 未接入 / 1 moderate | **零发现** / **零漏洞**（esbuild override） |
| jsx-a11y | 15 | **0**（真 button 化 9 + 定向豁免留因 6） |
| OpenAPI 契约 | 9 操作（名存实亡） | **70+ 操作** + 路由双向漂移守卫 + DASHBOARD_COLUMNS 对账 |
| 契约类型安全 | 12+ 断言逃逸、`unknown` 黑洞 | `widgetData<T>` 信封泛型、校验器收 `unknown`、收窄助手收口 |
| 安全基线 | SSRF IPv6 绕过·路径穿越·TOCTOU·data: CSP·明文 cookie 静默 | 全修 + **IP 钉死建连** + 启动告警 + 供应链归零 |
| 测试基建 | 40 脚本各自为战、明文口令、假绿断言、污染盘面 | `verify-kit`/`pnpm verify` 入口、fixture-guard 快照还原、精确匹配 |
| 体积（⑪） | 主包 1080KB/gzip 325KB | 1701KB/gzip **535KB**（ECharts 进包 = D55 预期，按需注册控制） |

**余量（留档，随常规维护渐进）**：内层子访问断言 ~40 处（总函数兜底、零运行时风险）；apiFetch 三处样式差异；
verify 残余固定 sleep；launcher/iframe 探活路径 TOCTOU（无凭证、仅探活）；i18n 全文案字典层（预留口径）；
DEP-3 声明滚动（周期性 `pnpm up`）；**真机待验清单**：~~图表真 HTTP 源~~ ✅ **已销**（`verify-chart-live` 5/5：Immich 真相册 16 相册 → 图表 16 点**与官方 API 对账**；
顺带真机炸出 SEC-3 钉 IP 未答 `lookup(all=true)` 形态的洞并修复）；**Glances 液面填充、图表真 WS 源** ——
**当前环境无实例**（.env.verify 无 GLANCES_URL/WS 源）→ 保持待办，有实例即跑（mock 已全验）。

**仍待用户拍板**：§4 的 **D10 口径**（768–1023px 平板竖屏可否编辑布局）——已在 07「待用户确认」，不影响上述收口。
