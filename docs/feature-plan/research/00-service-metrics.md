# 00 · 服务卡片指标调研（用户期望 × 真机实测可用性）

> **Q40a 产出**（2026-10-01）。背景：用户批评 Q39 的四服务（Immich/Navidrome/Portainer/Mihomo）指标"未提供计数指标/指标非常简单……完全是作为一个 demo 来做的"。根因是推导方向反了——**从"API 容易拿什么"出发，而不是从"用户想回答什么问题"出发**。本调研是新规范（[08-widget-quality.md](../08-widget-quality.md)）的"对照物"步骤产物，也是 Q45–Q48 指标重做的实施依据。
>
> 方法：①同类产品对照（Homepage / Homarr / 各服务官方 UI）；②**真实实例 API 探测**（用户提供的生产实例，2026-10-01 实测）。

## 1. 根因复盘（为什么上一版是 demo 级）

| # | 缺陷 | 实例 |
|---|---|---|
| 1 | 推导方向反了：API 给什么就显示什么 | Immich 只调 `/api/statistics`（404）→ 整卡"未提供计数指标"，而正确路由 `/api/server/statistics` 数据非常丰富 |
| 2 | 把"我没取到"写成"服务未提供" | Immich/Navidrome 提示文案在替开发者说谎，掩盖了接口调错的事实 |
| 3 | 无对照物 | 未调研官方 UI / Homarr / Homepage 对同一服务展示什么 |
| 4 | 无真机验证 | Q37 连了 Glances 真机所以效果好；四服务纯 mock，问题全部漏到用户手里 |
| 5 | 契约贫血 | `stats: [{label,value}]` 只能放孤零零的数字，放不下清单/状态/趋势（→ D48 契约演进） |

## 2. 对照物调研（同类产品展示什么）

| 服务 | 官方 UI | Homepage（gethomepage.dev） | Homarr |
|---|---|---|---|
| Immich | 管理端 Server Statistics：照片/视频数、磁盘占用、按用户分解 | widget 字段白名单：`["users","photos","videos","storage"]`；且按 Immich 版本切 API（v1.118 分界） | Immich 相册轮播（深度组件） |
| Navidrome | Web UI：曲库规模（曲目/专辑/艺术家）、最近添加、管理面板扫描状态（**「正在播放」Q94 已下线**） | widget 固定展示收听统计（无字段配置） | "media and listening statistics"（曲库+收听） |
| Portainer | 环境首页：stacks / 容器 running·stopped·paused / images / volumes / networks + 主机信息 + 事件 | Docker 模式字段：`["running","stopped","total"]`；K8s 模式：`["applications","services","namespaces"]` | （作为安装载体） |
| Mihomo/Clash | MetacubeXD 首页：**实时速率图**、当前出口节点/策略选择、活动连接、内存、累计流量 | 无官方 widget | 无官方 widget（社区多为自定义） |

**结论**：用户期望的通用形态 = **规模数字 + 健康/状态 + 活动（最近/正在发生）+（代理类）实时速率**。我们的卡片至少要做到前 3 层，速率进迷你图表（D48）。

## 3. 真机实测可用性（2026-10-01，用户生产实例）

### Immich（实测 v3.2.2，API Key 权限受限）

| 接口 | 状态 | 数据 |
|---|---|---|
| `GET /api/server/version` | ✅ | `{major:3,minor:2,patch:2}` |
| `GET /api/server/statistics` | ✅ | `photos=16309, videos=140, usage=95.2GB, usagePhotos, usageVideos, usageByUser[]`（每用户 photos/videos/usage/quota） |
| `GET /api/server/features` / `/api/server/config` | ✅ | 功能开关、trashDays 等 |
| `GET /api/server/ping` | ✅ | 探活 |
| `GET /api/users`、`/api/albums`、`/api/activities` | ❌ 403 | 当前 Key 缺 `user.read`/`album.read`/`activity.read`——"最近上传/近 7 天新增"需要扩权或改走 statistics |

- **教训实锤**：旧代码调的 `/api/server-info/version`、`/api/statistics` 在 v3 全部 404 → "未提供计数指标"纯属调错接口。新版路由前缀是 `/api/server/*`，且 API Key 是**细粒度权限**（Homepage 文档明确要求 `server.statistics` 权限，印证）。
- 兼容策略：`/api/server/statistics` → 回落 `/api/statistics`（旧版）→ 逐项降级；版本同理。

### Navidrome（实测 0.58.0，OpenSubsonic=true）

| 接口 | 状态 | 数据 |
|---|---|---|
| `GET /rest/getScanStatus.view` | ✅ | `count=1376`（曲目）、`folderCount=266`、`lastScan`、`scanning` |
| `GET /rest/getArtists.view` | ✅ | 38 位艺术家、合计 269 张专辑（artist.albumCount 求和） |
| `GET /rest/getAlbumList2?type=newest` | ✅ | 最近添加专辑（含封面/艺人/曲目数） |
| `GET /rest/getNowPlaying.view` | ~~✅~~ **已下线** | 正在播放（用户+曲目）—— **Q94（2026-10-02）按用户要求整体移除** |
| `GET /rest/getPlaylists.view`、`getLicense.view` | ✅ | 播放列表数、订阅状态 |
| `GET /rest/getStats.view` | ❌ 404 | **Navidrome 0.58 尚未实现 OpenSubsonic getStats**——旧代码把它当唯一数据源，缺失即整卡空白 |

- 曲目总数用 `scanStatus.count`；专辑/艺术家用 `getArtists` 聚合；（正在播放 `getNowPlaying` 已随 Q94 下线）。"总时长/存储"暂无直出接口 → 诚实降级或排后。

### Portainer（实测 2.27.6，admin API key，环境 Id=3 "local"）

| 接口 | 状态 | 数据 |
|---|---|---|
| `GET /api/endpoints/{id}/docker/containers/json?all=1` | ✅ | 25 容器：running=23 / exited=2，含名称、State、Status 文本（如 `Exited (1) 2 days ago`） |
| `GET /api/endpoints/{id}/docker/info` | ✅ | 宿主：mem=15GB、cpus=12、images=32、volumes=5 |
| `GET /api/system/status` / `/api/endpoints` | ✅ | 版本、端点列表（含 Snapshot） |
| `GET /api/stacks`、`/api/registries` | ✅ | 栈数、镜像仓库 |
| `GET /api/endpoints/{id}/docker/usage` | ❌ 404 | 该版本无容器资源用量聚合端点 → "哪个容器吃资源"排后（逐容器 stats 太重） |

- 用户最关心的"**我的容器都活着吗**"：running/stopped/**异常（Exited 非 0）计数 + 异常容器清单（名称+Status 文本）一次拿齐。

### Mihomo（实测 meta v1.19.31，metacubexd 同后端）

| 接口 | 状态 | 数据 |
|---|---|---|
| `GET /proxies` | ✅ | 21 个代理/策略组，组有 `now` 当前选择（如 `♻️ 自动选择→香港WAP-优化`）、`alive`、`history`（延迟记录） |
| `GET /connections` | ✅ | `downloadTotal=31.5GB, uploadTotal=12.9GB`、活动连接 87 条 |
| `GET /providers/rules`、`/providers/proxies` | ✅ | 规则数（custom=11）、订阅源（airport 等） |
| `GET /version`、`/configs` | ✅ | 版本、模式/端口/TUN |
| `GET /memory` | ❌ 挂起 | 经用户反代（clash-api.xfdzcoder.space）超时不可用 → 诚实降级 |
| `GET /traffic`（流式） | ❌ 空 | 反代缓冲流式响应，收不到增量 → **改用 `/connections` 总量差分**测实时速率（2 次轮询相减），同样可进迷你图表 |

- 实时速率 = 轮询差分方案已验证可行；当前出口节点 = 遍历策略组 `now`。

## 4. 用户期望指标清单（Q45–Q48 实施依据）

每条 = 用户问题 → 指标 → 来源 → 取不到时的降级（**禁止写"服务未提供"，必须写明原因**）。

### Immich（Q45）
| 用户问题 | 指标 | 来源 | 降级 |
|---|---|---|---|
| 库多大 | 照片数、视频数 | `/api/server/statistics` | 403 → "API Key 缺 server.statistics 权限（Immich 后台→账号→API Key 勾选）" |
| 存储撑得住吗 | 总占用（+照片/视频占比） | 同上 `usage/usagePhotos/usageVideos` | — |
| 谁在用 | 按用户分解（名称+照片+视频+占用） | `usageByUser[]` | — |
| 什么版本 | 版本号 | `/api/server/version` | — |
| 最近备份正常吗 | 最近上传/近 7 天新增 | `asset.read`/`activity.read` 扩权后排后 | 403 → "需 asset.read 权限" |

### Navidrome（Q46）
| 用户问题 | 指标 | 来源 | 降级 |
|---|---|---|---|
| 库规模 | 曲目、专辑、艺术家 | `scanStatus.count`、`getArtists` 聚合 | — |
| 最近加了什么 | 最近添加专辑 top3（封面+名+艺人） | `getAlbumList2?type=newest` | — |
| 现在谁在听什么 | 正在播放（用户+曲目） | `getNowPlaying` | 空 → "当前无人收听" |
| 库健康吗 | 上次扫描时间、扫描中状态 | `scanStatus` | — |
| 套件状态 | 订阅/license | `getLicense` | — |

### Portainer（Q47）
| 用户问题 | 指标 | 来源 | 降级 |
|---|---|---|---|
| **容器都活着吗** | running/stopped/**异常**计数（异常=Exited 非 0） | `containers/json?all=1` | 无 Docker 权限 → 说明缺权限 |
| 哪些炸了 | **异常容器清单**（名称+Status 文本） | 同上 | 空 → "全部正常"绿态 |
| 环境规模 | 端点数、镜像、卷、栈 | `docker/info`、`/api/stacks` | — |
| 宿主多大 | CPU 核数、内存总量 | `docker/info` | — |
| 最近发生什么 | 最近事件（启动/停止/退出） | Status 文本自带时间 | — |

### Mihomo（Q48）
| 用户问题 | 指标 | 来源 | 降级 |
|---|---|---|---|
| 现在走哪个出口 | 策略组当前选择（组→节点） | `/proxies` 各组 `now` | — |
| 快不快 | 节点延迟（history 最近一条） | `/proxies` | 无记录 → "未测速" |
| 网速多少 | 实时上/下行（轮询差分） | `/connections` totals 差分 | — |
| 连了多少 | 活动连接数 | `/connections` | — |
| 累计流量 | 累计上/下行 | 同上 | — |
| 服务健康 | 版本、规则数、订阅源数 | `/version`、`/providers/rules`、`/providers/proxies` | — |
| 内存占用 | 内存 | `/memory` | 反代下挂起 → 该项标注"获取失败（超时）" |

## 5. 其它教训（入 08 规范）

1. **API 随版本演进**：Immich v1→v3 路由整体搬迁、Navidrome getStats 未落地——适配器必须多路由回落 + 版本探测，真机验证是唯一可信手段。
2. **权限即产品体验**：Immich Key 细粒度权限 → 取不到 ≠ 服务没有；降级文案要告诉用户**怎么修**（勾哪个权限）。
3. **反代会破坏流式/慢接口**：mihomo `/traffic` 流被缓冲、`/memory` 挂起——设计方案要能降级（轮询差分替代流式）。
4. **同构接口聚合**：Navidrome 无 getStats 就用 getArtists+scanStatus 聚合出等价指标，不要因"官方统计接口缺失"就空卡。
