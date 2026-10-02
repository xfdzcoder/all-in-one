import { IconDiscOff, IconRefresh } from "./icons";
import { useState } from "react";
import { Text } from "@mantine/core";

import { useMediaOptionLabel, useNavidromeLibrary, useSourceMeta } from "./data-hooks";
import { WidgetTitle } from "./widget-title";
import { MediaLightbox } from "./media-lightbox";
import { MediaWall } from "./media-wall";
import { ServiceIcon } from "./service-icon";
import { SourceHint, WbAlert, WbLoading, IconAction } from "./ui";

/**
 * Navidrome 专辑墙（FR-X3 只读深度，**D50**）：最近添加专辑网格。
 * 封面由服务端代取为 data URI（Subsonic 认证不进前端 SEC3）。
 * **D54**：播放遥控（FR-X3e）已移除 —— 本组件回归纯只读，无任何写操作。
 */
export function NavidromeLibraryWidget({
  sourceId,
  limit = 12,
  refreshSec,
  layout = "grid",
  randomIntervalSec = 30,
  rowHeight = 72,
  /** @deprecated QA-002：旧键（语义已是「目标行高」），仅迁移期双读 */
  minCell,
  artistId,
}: {
  sourceId?: string;
  limit?: number;
  refreshSec?: number;
  /** Q71（项 6）：`grid` 铺开 / `random` 随机单图定时换。 */
  layout?: "grid" | "random";
  randomIntervalSec?: number;
  /** Q89（D60 §3）/ QA-002：**目标行高** px。配置键已迁 `rowHeight`；`minCell` 仅迁移期双读。 */
  rowHeight?: number;
  /** @deprecated QA-002：旧键双读 */
  minCell?: number;
  /** Q72/Q87：只看某个艺人（留空 = 全部）。 */
  artistId?: string;
}) {
  const { data, loading, error, refresh } = useNavidromeLibrary(sourceId, limit, refreshSec, artistId);
  const [preview, setPreview] = useState<{ cover: string; name: string; artist?: string } | null>(null);
  // WEB-12：连接元信息一次订阅（Q86/D59 标题区跳转到该数据源站点）
  const { row, homeUrl } = useSourceMeta(undefined, sourceId);
  // Q94（反馈④）：标题带上**所选艺人名**（配置只存 id，这里解析成名称）
  // WEB-10：只订阅「艺人选项」一个查询（原先 useDynamicOptionsMap 会拉 12+ 个查询）
  const artistLabel = useMediaOptionLabel(artistId ? "navidrome-artists" : undefined, sourceId, artistId);

  return (
    <div className="wb-widget">
      <WidgetTitle
        icon={<ServiceIcon name="navidrome" size={16} />}
        title={
          <>
            专辑墙{row?.name ? ` · ${row.name}` : ""}
            {artistLabel ? ` · ${artistLabel}` : ""}
          </>
        }
        href={homeUrl}
        actions={<IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>}
      />

      {!sourceId && <SourceHint text="暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加 Navidrome 连接" />}
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}

      {data && data.albums.length === 0 && !error && (
        <Text size="xs" c="dimmed">
          暂无专辑
        </Text>
      )}
      {data && data.albums.length > 0 && (
        <MediaWall
          items={data.albums.map((a) => ({
            id: a.id,
            src: a.cover,
            title: `${a.name}${a.artist ? ` · ${a.artist}` : ""}`,
            // D60 §1：封面原始宽高来自服务端字节头解析 → 前端据此等比装箱（Q89）
            width: a.width,
            height: a.height,
            placeholder: { icon: <IconDiscOff size={18} aria-hidden />, label: "封面不可用" },
          }))}
          layout={layout}
          randomIntervalSec={randomIntervalSec}
          targetRowHeight={rowHeight ?? minCell ?? 72}
          onOpen={(it) => {
            const a = data.albums.find((x) => x.id === it.id);
            if (a) setPreview({ cover: a.cover, name: a.name, artist: a.artist });
          }}
        />
      )}
      {(data?.notes ?? []).length > 0 && (
        <div className="wb-svc-notes">
          {(data?.notes ?? []).map((n, i) => (
            <Text key={i} size="xs" c="dimmed">
              · {n}
            </Text>
          ))}
        </div>
      )}

      {preview && (
        <MediaLightbox
          src={preview.cover || undefined}
          title={`${preview.name}${preview.artist ? ` · ${preview.artist}` : ""}`}
          onClose={() => setPreview(null)}
        >
          <div className="wb-gallery__placeholder wb-gallery__placeholder--wide">
            <IconDiscOff size={28} aria-hidden />
            <Text size="xs" c="dimmed" ta="center">
              封面不可用
            </Text>
          </div>
        </MediaLightbox>
      )}
    </div>
  );
}
