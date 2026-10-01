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
