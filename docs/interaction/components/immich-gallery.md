# 组件 · Immich 照片墙

> 层级：页面 → 组件 → 按钮。约定见 [../README.md](../README.md)；问题见 [../00-issues.md](../00-issues.md)。
> FR：FR-X3 只读深度（**D50**，Q50 落地）——照片墙展示，不改 Immich 任何数据。

**截图**：待补（`assets/c-immich-gallery.png`）。

## 配置（configSchema）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sourceId` | select（动态） | — | **数据连接**（Immich） |
| `limit` | number | 12 | 显示张数（1–120，最近上传优先；**视频不展示**，Q88） |
| `albumId` | select（动态） | — | **只看相册**（Q72/**D57**：选项随「数据连接」变化；留空 = 整个图库） |
| `layout` | select | grid | `grid` 铺开 / `random` 随机单图定时换（Q71） |
| `randomIntervalSec` | number | 30 | 仅随机模式生效（最短 3s） |
| `rowHeight` | number | 72 | **目标行高**（px，QA-002 起用新键；旧键 `minCell` 迁移期双读） |
| `refreshSec` | number | 300 | 标准刷新字段 |

> 空态：未选连接 →「暂无数据连接 —— 请到数据源管理 · 数据连接添加 Immich 连接」；已选但无照片 →「暂无照片」。

## 数据流

```
POST /api/widgets/data { type:"immich-gallery", config:{ sourceId, limit, albumId } }
  ──► search/metadata（albumIds 过滤，Q81）→ 略视频（Q88）→ 逐张 thumbnail 代取
  ──► items: [{ id, thumb(data URI, mime 按字节头 QA-001), href, at, width/height, type }]
```

缩略图抓取 = `mapLimit` 并发 8 + 20s 总预算（Q99a/SRV-29）；失败项**不丢格子**（占位块）+ 原因聚合一条 note（Q70）。宽高来自字节头解析（D60）→ 前端等比装箱（D62 全局固定行高）。

## 结构

| 区块 | 内容 |
|---|---|
| 头部 | WidgetTitle：logo + 「照片墙 · <数据源名> · <相册名>」（**仅标题区可点**跳 Immich 站点，D59/Q86）+「刷新」 |
| 媒体墙 | `.wb-gallery` 等高行 justified 布局（`media-wall-layout.ts` 纯函数） |
| notes | 抓取失败聚合提示（`.wb-svc-notes`） |

## 交互点

### 按钮 · 刷新

- **触发**：force 回源（FR-I3）；`refetchInterval = refreshSec`。

### 媒体格 · 预览遮罩

- **触发**：点击格子 → `.wb-lightbox` 全屏遮罩（**无边框/无圆角/无阴影**，Q82 项 9）。
- **逐步行为**：显示大图 + 拍摄时间；「在 Immich 中打开」为 icon 链接（Q84）；`←/→` 或圆形按钮**循环切换**（Q73）；Esc 关闭。
- **状态与边界**：切换后内容必变（Q83 严格断言）；遮罩内不改任何数据（只读，D50）。

## 已知问题

见 [../00-issues.md](../00-issues.md)（媒体墙相关历史问题已清）。
