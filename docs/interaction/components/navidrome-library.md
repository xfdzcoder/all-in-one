# 组件 · Navidrome 专辑墙

> 层级：页面 → 组件 → 按钮。约定见 [../README.md](../README.md)；问题见 [../00-issues.md](../00-issues.md)。
> FR：FR-X3 只读深度（**D50**，Q51 落地）——专辑封面墙；**播放遥控已 D54 移除**（回归纯只读）。

**截图**：待补（`assets/c-navidrome-library.png`）。

## 配置（configSchema）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sourceId` | select（动态） | — | **数据连接**（Navidrome） |
| `limit` | number | 12 | 显示张数（1–120，最近添加优先） |
| `artistId` | select（动态） | — | **只看艺人**（Q72/**D57**：选项随连接变化；留空 = 整个曲库） |
| `layout` / `randomIntervalSec` / `rowHeight` / `refreshSec` | — | grid / 30 / 72 / 300 | 同照片墙（`rowHeight` = 目标行高，QA-002） |

> 艺人过滤走 `getArtist.view?id=` → `artist.album[]`（Q94/反馈③：`getAlbumList2?type=byArtist` **Navidrome 未实现**，实测报 `not implemented`）。

## 数据流

```
POST /api/widgets/data { type:"navidrome-library", config:{ sourceId, limit, artistId } }
  ──► getAlbumList2 或 getArtist.view（Q81/Q94）→ 逐张 getCoverArt 代取（并发 8 + 20s 预算，Q99a）
  ──► albums: [{ id, name, artist, cover(data URI，mime 按字节头 QA-001) }]
```

封面过 `COVER_MAX_BYTES` 上限 + `size=300` 二级回落（Q70/Q88）；缺封面**不丢格子**（占位块）。

## 结构

| 区块 | 内容 |
|---|---|
| 头部 | WidgetTitle：logo + 「专辑墙 · <数据源名> · <艺人名>」（仅标题区可点跳 Navidrome 站点，D59）+「刷新」 |
| 媒体墙 | 同照片墙（`.wb-gallery`，D62 全局固定行高） |

## 交互点

### 按钮 · 刷新

- **触发**：force 回源（FR-I3）。

### 媒体格 · 预览遮罩

- **触发**：点击格子 → `.wb-lightbox`（专辑名 + 艺人名；无边框遮罩，Q82 族）。只读。

> **无播放/暂停/上一首/下一首按钮**（D54 明确移除，verify-svc 有反向断言防回归）。

## 已知问题

见 [../00-issues.md](../00-issues.md)。
