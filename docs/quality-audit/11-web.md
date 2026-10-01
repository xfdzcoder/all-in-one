# 11-web · `apps/web/src` 分区质量评估

> 范围：React 19 + Mantine v9 + @tanstack/react-query + gridstack 的 Web 宿主（约 50 文件 / 8800 行）。
> 方法：逐文件通读 + 关键行为实证（Mantine 9 Button.css 尺寸变量、服务端 PATCH 合并语义等以实测为准）。
> 未覆盖文件见文末清单（时间盒收尾，未深挖部分不入台账）。

## 台账

| ID | 位置 | 问题 | 级别 | 建议修法 |
|---|---|---|---|---|
| WEB-1 | `apps/web/src/mail-widget.tsx:31,67` | 邮箱多选过滤是**客户端**的：`useMailMessages(undefined, limit)` 先按全局取 20 封，再用 `allowIds` 过滤。选中 1 个账号时，20 封里可能只有几封属于它 → 列表近乎空白，用户以为「没邮件」（功能缺陷，limit 语义被过滤破坏） | P1 | 账号过滤下推服务端（`account`/`accountIds` 参数），或按账号数放大 limit / 分账号取数后合并 |
| WEB-2 | `apps/web/src/data-admin.tsx:184-188` + `apps/server/src/data-source/routes.ts:121-128` | 编辑数据连接时 `clean` 把空串/undefined 字段**整体剔除**，而服务端 PATCH 是「合并保留旧值」→ **任何文本字段都无法清空**。最危险是 Portainer `restartAllow`：用户清空「重启白名单」想禁重启，保存后旧白名单仍在（D51「留空=禁止重启」失效），UI 看起来已清空 | P1 | 前端区分「未改动」与「显式清空」：编辑时预填原值、提交全量字段；或服务端提供 delete 语义。`restartAllow` 改为显式 `[]`/`null` 表示禁用 |
| WEB-3 | `apps/web/src/portainer-containers-widget.tsx:68-102` + `confirm.tsx:36` | 容器行是 `<button>`，内部又嵌 `ConfirmAction` 的 ActionIcon `<button>` —— **非法嵌套交互元素**（React DOM 嵌套告警 / AT 行为未定义），且点击「重启」事件冒泡到行 onClick → 确认框与日志 Modal **同时弹出** | P1 | 行改 `<div role="button">` 或把重启钮移出行按钮外；ConfirmAction 触发器内 `stopPropagation` |
| WEB-4 | `data-hooks.ts:222-224,251-253,357-359,392-394,624,734`；`kanban-widget.tsx:75`；`data-admin.tsx:505,522,533`；`mail-accounts.tsx:174`；`App.tsx:383` | 大量 `void promise.then(...)` **无 `.catch()`**（手动刷新 force 回源、kanban 批量 patchCard、创建看板、删除账号、退出登录）→ 失败产生 unhandled rejection、UI 无任何反馈（对照 `forceRefetch`（data-hooks.ts:46）与 `plugin-frame.tsx:158` 是有 catch 的，双标） | P1 | 统一 `.catch` → 提示条/`onError`；建议封装 `useSafeRefresh` 或统一走 `forceRefetch` 范式 |
| WEB-5 | `data-hooks.ts:724` vs `:734` | `useFeeds`：queryFn 发送**清洗后**的 `tags`，refresh（force）却发送**原始** `tagIds`（Q93 注释明言可能是 `""`/非数组畸形值）→ 畸形配置下「查询正常、点刷新报错」的不一致行为 | P1 | refresh 复用同一份 `tags` 清洗逻辑（把清洗提到 key 构造处共用） |
| WEB-6 | `todo-widget.tsx:67,77,91,109,137`；`kanban-widget.tsx:57,306,320,421,431,444`；`rss-widget.tsx:78`；`tag-filter.tsx:54`；`data-admin.tsx:297,316,326,349,359,582,594,604,613,631` | `useMutation(...).mutate(...)` 全部未接 `onError`/未读 `mutation.error`（只有 addSource/createTag 两处有）→ 勾选、增删卡、打标签等失败**静默**，界面看似成功 | P1 | 每个 mutation 统一挂 `onError`（或 hook 内置全局错误通道 → WbAlert/toast）；至少把 `mutation.error` 渲染出来 |
| WEB-7 | `error-boundary.tsx` + `widget-chrome.tsx:63` | ErrorBoundary **只覆盖 gridstack 卡片内部**（Q93）；`App`/`Board` 工具栏/配置 Modal（`ConfigForm`）/`DataAdmin`/`PluginAdmin`/`LoginPage` 均无边界 —— 任一处 render 抛错仍整页白屏且不可恢复（如 `RelativeTime` 见 WEB-9） | P1 | 在 `App` 根、`Board`、`DataAdmin` 各挂一层边界（可复用 `WidgetErrorBoundary`，去掉 name 或传页面名） |
| WEB-8 | `data-hooks.ts:14,66-73,425,470` | ⑤ 缩略图 base64 **常驻 + churn**：immich/navidrome 的 data URI 存进 react-query 缓存（queryClient 未配 `gcTime`，默认 5 分钟；挂载期无限驻留），且 SSE 兜底轮询 `invalidateAllData` 每 30s 失效 `["immich-gallery"]`/`["navidrome-library"]` → 反复重取整批 base64 字符串（12 张 × ~50-100KB × N 卡），旧字符串制造 GC 压力 | P1 | ① 缩略图类查询设小 `gcTime`/`staleTime` 与 `structuralSharing` 关闭策略；② 轮询/SSE 失效对含 base64 的 key 降频或只失效不含图的元数据；③ 长期改 URL 引用（服务端缓存 + `<img src=/api/...>`）替代 data URI |
| WEB-9 | `ui.tsx:131-133` | `RelativeTime` 对 `value` 无防护：`new Date(value).toISOString()` 在非法时间（空串/脏数据）**render 期抛 RangeError** → 整卡崩溃（`formatRelative` 有防护，`RelativeTime` 却先算 `abs`） | P1 | 与 `formatRelative` 同样判 `Number.isFinite(t)`，非法时回退 `"—"` |
| WEB-10 | `immich-gallery-widget.tsx:55-56`；`navidrome-library-widget.tsx:46-47` | 为解析**一个**相册/艺人名挂 `useDynamicOptionsMap()` —— 该 hook 内部触发 12+ 个查询（tags/todos/boards/mail/4 类连接/媒体选项，data-hooks.ts:845-872），每张画廊卡都订阅全部查询、任一失效即整卡重渲染（过度取数 + 无谓重渲染） | P1 | 抽小 hook（如 `useMediaOptionLabel(dynamic, sourceId, id)` 只查 scoped `media-options` 一个 key） |
| WEB-11 | `data-hooks.ts:54-76` + 各 hook 的 key 构造（`:155,209,232,343,378,424,469,504,550,589,611,684,721`） | queryKey 字符串拼接散落各处、`invalidateAllData` 手抄 18 个 key 常量 —— 新增查询忘加一处即「SSE/轮询通知不到」（Q87 已踩过一次，见 :65 注释）；`forceRefetch` 调用点还要把 key **再抄一遍**（:448,492,527,567,604） | P2 | 集中 `keys.ts`（key 工厂函数），`invalidateAllData` 改为遍历 key 注册表；forceRefetch 由 hook 内部自取 key |
| WEB-12 | `monitor-widget.tsx:66-69`；`immich-gallery-widget.tsx:50-53`；`portainer-containers-widget.tsx:20-23`；`service-overview-widget.tsx:135-138`；`mihomo-nodes-widget.tsx:16-17` | 服务类组件样板重复：各自手写「`useDataSources()` 全量查表找 row + `useSourceHomeUrl()` 内部**再**查一次全量」（两次订阅/请求同端点），标题簇/刷新钮/空态引导文案也在 8 个 `*-widget.tsx` 重复 | P2 | 抽 `useSourceRow(sourceId)`（一次查询返回 row+homeUrl）与 `WidgetShell`（标题/动作簇/空态/错误态骨架） |
| WEB-13 | `App.tsx:507-512` | `check()` 的 catch 两分支完全相同（401 与网络故障都 `setSession(anonymous)`）—— 死分支 + 网络抖动误导到登录页、无「服务不可达」提示 | P2 | 区分 401 → 登录页；其它错误 → 错误页/重试按钮（文案给「原因+怎么修」） |
| WEB-14 | `App.tsx:383` + `queryClient`（data-hooks.ts:13） | 退出登录不清 react-query 缓存：上一会话的任务/邮件/**缩略图 base64** 全部留在内存，重新登录（含换用户场景）直接可见旧数据 | P2 | `onLogout` 时 `queryClient.clear()`（顺带释放 base64 内存） |
| WEB-15 | `media-lightbox.tsx:46-79` | ⑦ a11y：`role="dialog" aria-modal="true"` 但**无 focus trap、打开不聚焦、关闭不还焦点、背景不 inert** —— 键盘/读屏用户焦点留在被遮罩的底层 | P2 | 挂载时聚焦容器/关闭钮、Tab 循环或复用 Mantine `Modal`/focus-trap、卸载还原焦点；背景加 `inert` |
| WEB-16 | `kanban-widget.tsx:391` vs `confirm.tsx:46` | 卡片编辑 Modal `opened={editing !== null}` **常驻挂载**（与 confirm.tsx:46「条件挂载避免 DOM 膨胀」的教训相悖），多卡看板长期多挂一棵 Modal 子树 | P2 | 同 confirm：`{editing && <Modal opened …>}` |
| WEB-17 | `Board.tsx:284-306,334-340` | 卸载时序漏洞：cleanup 清掉 `retryTimer` **之后**才 `flush()`；若此刻保存失败，catch 里又新建 retryTimer —— 组件已卸载仍无限退避重试 + `setState`（卸载后 pendingJson 丢失的改动会永远重试或无声丢失） | P2 | flush 增加 `unmounted` 标记/AbortController；失败重试前判断存活，或把重试上移到全局保存队列 |
| WEB-18 | `Board.tsx:374-399` + `ConfigForm.tsx:198` + `WidgetPicker.tsx:90-105` | 双击竞态：ConfigForm 提交按钮无 busy 禁用（WidgetPicker 只改 label 为「添加中…」），`saveConfig`/`onAdd` 无 in-flight 守卫 → 双击重复添加组件、**重复创建凭证**（propsWithSecretRefs 每次新建 credential，config-form-utils.ts:76） | P2 | 提交按钮 `disabled={busy}` + promise 去重；凭证创建失败/重复要有回收策略 |
| WEB-19 | `Board.tsx:53,220-227` | `pluginComponentCache` 模块级 Map **只增不减**：卸载插件后组件闭包（含旧 manifest 快照）常驻内存；若同 id 的插件重装/换 manifest，缓存组件仍持旧 manifest | P2 | 卸载/禁用时 delete 缓存；或缓存键带 manifest 版本 |
| WEB-20 | `todo-widget.tsx:88,133` 等 44 处 `size="compact-xs"`（data-admin:263,314,322,442,500,565,592,600,610,786,805,896；kanban:92,101,115,315,327,334,366,374；mail-*、plugin-admin、icon-library、tag-filter、monitor、service-overview、custom-api） | 实测结论：**仅用在 Button 上**（Mantine 9 `Button.css` 有 `--button-height-compact-*` 变量，合法；ActionIcon/Badge/Input 无 compact 变量，未发现误用）。但 `confirm.tsx:24` 把 `size` 类型硬编码为 `"compact-xs"\|"xs"`，历史隐患随时回潮；且样式补丁散在 `styles/widgets.css:1343-1352`（InputClearButton compact 变量手工补齐） | P2 | 语义尺寸收敛（如统一 `size="xs"` + 间距类），或在 theme 层定义一处；给 lint/类型加约束防止 Badge/Input 用 compact-* |
| WEB-21 | `todo-widget.tsx:114`；`data-admin.tsx:298` | `aria-label={`toggle ${t.title}`}` 中英混杂（"toggle"），且与确认按钮 `label="×"`（todo-widget.tsx:132）一样是纯符号可访问名 —— ⑦/i18n 文案不一致 | P2 | 统一中文可访问名（如「完成：{title}」「删除任务」） |
| WEB-22 | `widget-registry.ts:136`（manifest 名「信息流」）vs `rss-widget.tsx:36`（标题「RSS」）；`tag-filter.tsx:64`（「数据管理」）vs 全局「数据源管理」；`widget-registry.ts:26`「任务分组名」vs UI「ToDo/清单」混用（data-admin.tsx:249,256,266） | ⑧ 术语不统一：同一事物在选择器/卡片/管理面叫不同名字（信息流↔RSS、数据管理↔数据源管理、分组↔ToDo↔清单），i18n 也无收口（全部文案内联在 tsx，无文案表/字典层） | P2 | 建 `strings.ts`（或文案字典）统一术语表；至少先统一「信息流(RSS)/数据源管理/清单」三组叫法 |
| WEB-23 | `mail-widget.tsx:130`；`html-sandbox.tsx:12`；`plugin-frame.tsx:192,209`；`kanban-widget.tsx:243`；`custom-api-widget.tsx` 等大量 `style={{...}}` | D39「类名即公共 API」下仍有大量内联 style（布局/字号/颜色），`/custom.css` 无法覆盖 —— 用户自定义样式契约被绕过 | P2 | 补语义类（`.wb-mail-body` 等），内联只留动态值（宽高/位置） |
| WEB-24 | `widget-registry.ts:255-256,132` | 注释错位/重复：「邮件组件（Q7b）」注释挂在 `serviceOverviewManifest` 之上；「gridstack components 映射」注释挂在 `rssManifest` 之上（真映射在 :411） | P2 | 移正注释（纯清理） |
| WEB-25 | `rss-widget.tsx:57`（`key={e.title}`）；`launcher-widget.tsx:52`（`key={it.url}`） | 列表 key 可重复：两个同名订阅源 / 两个同 URL 入口 → React key 冲突、错位更新 | P2 | 用稳定 id（source id / index+url 组合） |
| WEB-26 | `data-admin.tsx:250-253` | `label: dashboards ? n : n` 死三元（两分支相同）—— 残留半截逻辑 | P2 | 直接 `label: n`；若本意是标注「所在页面」，按 :277 的 `dash` 实现 |
| WEB-27 | `data-admin.tsx:209`（placeholder「搜索任务 / 订阅源 / 标签…」）vs 任务 Tab（:237-241 未用 `q` 过滤） | 搜索框声称搜任务，任务列表不响应 `q` —— 文案承诺与实现不符 | P2 | 任务行按 `title/list` 过滤，或改 placeholder 文案 |
| WEB-28 | `custom-api-widget.tsx:92`；`monitor-widget.tsx:186`；`icon-library.tsx:126` | `setTimeout(() => setCopied(...), 2000)` 无 cleanup：2s 内关弹窗/卸载 → 卸载后 setState（React 18 无害但属泄漏），多个 timer 无句柄 | P2 | `useEffect` 管理 timer 或卸载前 clearTimeout |
| WEB-29 | `data-hooks.ts:197-201` | `useDraft` 注释宣称「组件卸载安全的本地输入状态」，实现就是裸 `useState` —— 注释误导（历史上可能删过防护） | P2 | 改正注释或补真实防护 |
| WEB-30 | `media-wall.tsx:3` | `import ... from "./media-wall-layout.ts"` 带 `.ts` 后缀，与全仓省略后缀的写法不一致（依赖 bundler/allowImportingTsExtensions 特殊配置） | P2 | 统一省略扩展名 |

## 存疑（不入台账）

- `size="compact-xs"` 在 Mantine 9 Button 上实测有效（`Button.css` 定义 `--button-height-compact-*`），历史上「Badge/Input 上无效」的问题**本区未发现实例**；但 `InputClearButton` 的 compact 变量靠 `styles/widgets.css:1343-1352` 手工补 —— 升级 Mantine 时需复查（并入 14 分区依赖项更合适）。
- `Board.tsx:247` 注释称 key 含 `cellHeight`，实际 App.tsx:472 key 是 `${active.id}-${active.columns}`（行高走实时 `grid.cellHeight()`）—— 注释过时但行为正确，疑似有意为之，未入台账。
- `kanban-widget.tsx:61-76 moveCardToIndex` 并发发多个 `patchCard`（各带一次 invalidate），极端手速下可能交错 sortOrder；有 `dropTargetRef` 同步防护，未实测复现。
- `plugin-frame.tsx:128-131` `postMessage(..., "*")` 目标源通配：iframe 为不透明源（sandbox 无 allow-same-origin）只能如此，且有 `e.source` 校验（:137），评估为可接受，不算缺陷。
- `media-wall.tsx:74-80` 随机模式 count 变化时 `setRandIdx` 在 effect 中执行（oxlint react/set-state-in-effect 类规则可能告警），行为正确，未入台账。

## 未覆盖文件（时间盒收尾，未深挖）

`widgets.tsx`、`jsx-template.tsx`（受限 JSX 渲染器 —— 安全面建议由 12/14 分区复核）、`service-icon.tsx`、`random-id.ts`、`widget-edit-context.ts`、`grid-rescale.ts`/`grid-rescale.test.ts`、`media-wall-layout.ts`/`media-wall-layout.test.ts`、`main.tsx`、`styles/*.css`（仅抽查 `widgets.css` compact 补丁段）、`data-hooks.ts` 之外的测试文件（归 13 分区）。

## 条目统计

- **P0：0 条**
- **P1：10 条**（WEB-1 … WEB-10）
- **P2：20 条**（WEB-11 … WEB-30）
