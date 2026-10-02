# 测试脚本与 e2e 分工（TST-23 覆盖矩阵收口）

> 入口：`pnpm verify list | smoke | <脚本名...>`（`run-verify.mjs`，TST-18）。
> 公共原语：`lib/verify-kit.mjs`（登录 / `makeOk` / `makeClickBtn` / `waitFor` / `uniqId` /
> `ADMIN_PASSWORD` 口令单点 / `makeApiFetch` / `summarize`）——**手抄这些原语前先看 kit**（TST-14/15/17）。
> 所有动布局的脚本接 `lib/fixture-guard.mjs`（测前快照、测后还原；数据实体同理，TST-19/21）。

## 两套体系的分工

| 体系 | 位置 | 职责 | 触发 |
|---|---|---|---|
| **Playwright e2e** | `apps/web/e2e/journeys.spec.ts` | **MVP 出口旅程 J1–J4**（D15：e2e 全绿 = 出口门槛之一），真浏览器按旅程断言 | 手动 / 发版前 |
| **puppeteer verify** | `apps/web/scripts/verify-*.mjs` | **全特性验收**：每个特性域一份（J5–J8、SVC/PL/live、灰阶/暗色对比度、图标库、数据通道……），可单跑、可跑批（`pnpm verify smoke`） | 每批门禁（D53）+ 改动面冒烟 |

## 覆盖矩阵（旅程 / 特性 → 脚本）

| 旅程/特性 | Playwright e2e | puppeteer verify | 说明 |
|---|---|---|---|
| J1 首跑登录/默认页 | ✓ `journeys.spec.ts` | `verify-m1`（重叠，超集） | 双实现 |
| J2 编辑→拖拽→保存→恢复 | ✓ | `verify-drag`/`verify-gdrag`（超集：多路径压测） | 双实现 |
| J2b 添加组件持久化 | ✓ | `verify-m1` 侧重 | 双实现 |
| J3 移动端 | ✓ | `verify-nfr3`/`verify-w4`（部分重叠） | 双实现 |
| J4 数据/视图分离（D43） | ✓ | `verify-j4`（**超集**：多 SSE 同步断言） | **双实现，见下** |
| J5/J6/J7/J8（MVP 出口系列） | — | `verify-j5`/`j6`/`j7`/`j8` | verify 独有 |
| 服务接入 / 插件 / 真机 | — | `verify-svc`/`pl5–pl8`/`verify-live`/`verify-gallery-live` | verify 独有 |
| 图表卡（mock / 真源） | — | `verify-chart`/`verify-chart-live`（Immich 真相册对账） | verify 独有 |
| 暗色 / 灰阶对比度 | — | `verify-dark`/`verify-gray` | verify 独有 |

## 双实现同步规则（**TST-23 核心**）

J1–J4 同时存在 Playwright 与 puppeteer 两份实现，**选择器/文案/流程改动必须两处同改**。
已发生过的漂移（引以为戒）：

- WEB-22 术语统一把「ToDo 选择」改成「分组选择」——只改了 `verify-j4.mjs`，`journeys.spec.ts`
  仍找旧 aria-label，e2e 整条超时挂（2026-10-02，记录 174）。
- Q85 标题改「RSS」后 verify-fr3 的标记还找「信息流」（Q92 轮修）。

**动手前 grep 两处**：`grep -rn "<选择器/文案>" apps/web/scripts apps/web/e2e`。

## 断言集差异（有意为之，不是失同步）

`verify-j4` 是 J4 的**超集**：除数据/视图分离外还断言 **SSE 双组件同步**（数据源管理新建 →
组件无刷新即可见）与查询失效路径。e2e 侧只保留 **MVP 出口最小集**（D15 口径）——
差异属职责分工；若给 e2e 加断言，反向不必删 verify 侧。
