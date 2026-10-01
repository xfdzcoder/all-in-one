import { IconExternalLink, IconPhotoOff, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { Badge, Group, Text } from "@mantine/core";

import { useDataSources, useImmichGallery, useMediaOptionLabel, useSourceHomeUrl } from "./data-hooks";
import { MediaLightbox } from "./media-lightbox";
import { MediaWall } from "./media-wall";
import { WidgetTitle } from "./widget-title";
import { ServiceIcon } from "./service-icon";
import { RelativeTime, WbAlert, WbLoading, IconAction } from "./ui";

/**
 * Immich 照片墙（FR-X3 只读深度，**D50**）：最近照片网格。
 * 缩略图由服务端代取为 data URI（凭证不进前端 SEC3）；点击新标签开 Immich 原图页；
 * 只读 —— 无上传/删除/收藏等写操作（写操作类待拍板，FR-X3b）。
 */
export function ImmichGalleryWidget({
  sourceId,
  limit = 12,
  refreshSec,
  layout = "grid",
  randomIntervalSec = 30,
  minCell = 72,
  albumId,
}: {
  sourceId?: string;
  limit?: number;
  refreshSec?: number;
  /** Q71（项 6）：`grid` 铺开 / `random` 随机单图定时换。 */
  layout?: "grid" | "random";
  randomIntervalSec?: number;
  /** Q89（D60 §3）：**目标行高** px（配置键仍叫 `minCell`，为兼容既有配置）。
   *  行高由等比装箱反推，不再「只限最小、不限最大」地撑满卡片。 */
  minCell?: number;
  /** Q72/Q87：只看某个相册（留空 = 全部）。 */
  albumId?: string;
}) {
  const { data, loading, error, refresh } = useImmichGallery(sourceId, limit, refreshSec, albumId);
  const [preview, setPreview] = useState<{ thumb: string; href: string; at: string } | null>(null);
  // Q73（项 8）：铺开模式预览支持左右切换（循环）
  const [previewIdx, setPreviewIdx] = useState(0);
  const step = (d: number) => {
    const items = data?.items ?? [];
    if (items.length === 0) return;
    const next = (previewIdx + d + items.length) % items.length;
    setPreviewIdx(next);
    const it = items[next];
    setPreview({ thumb: it.thumb, href: it.href, at: it.at });
  };
  const all = useDataSources();
  const row = (all.data ?? []).find((r: { id: string }) => r.id === sourceId);
  // Q86/D59：标题区跳转到 Immich 站点
  const homeUrl = useSourceHomeUrl(sourceId);
  // Q94（反馈④）：标题带上**所选相册名**（配置只存 id，这里解析成名称）
  // WEB-10：只订阅「相册选项」一个查询（原先 useDynamicOptionsMap 会拉 12+ 个查询）
  const albumLabel = useMediaOptionLabel(albumId ? "immich-albums" : undefined, sourceId, albumId);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <WidgetTitle
          icon={<ServiceIcon name="immich" size={16} />}
          title={
            <>
              照片墙{row?.name ? ` · ${row.name}` : ""}
              {albumLabel ? ` · ${albumLabel}` : ""}
            </>
          }
          href={homeUrl}
        />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>

      {!sourceId && (
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加 Immich 连接
          </Text>
        </div>
      )}
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {data && data.items.length === 0 && !error && (
        <Text size="xs" c="dimmed">
          暂无照片
        </Text>
      )}
      {data && data.items.length > 0 && (
        <MediaWall
          items={data.items.map((it) => ({
            id: it.id,
            src: it.thumb,
            title: it.at ? new Date(it.at).toLocaleString("zh-CN") : undefined,
            // D60 §1：原始宽高来自服务端字节头解析 → 前端据此等比装箱（Q89）
            width: it.width,
            height: it.height,
            badge:
              it.type === "VIDEO" ? (
                <Badge size="xs" className="wb-gallery__video" color="dark" variant="filled">
                  视频
                </Badge>
              ) : undefined,
            placeholder: { icon: <IconPhotoOff size={18} aria-hidden />, label: "缩略图不可用" },
          }))}
          layout={layout}
          randomIntervalSec={randomIntervalSec}
          targetRowHeight={minCell}
          onOpen={(it, i) => {
            setPreviewIdx(i);
            const src = data.items.find((x) => x.id === it.id);
            if (src) setPreview({ thumb: src.thumb, href: src.href, at: src.at });
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
          src={preview.thumb || undefined}
          meta={preview.at ? <RelativeTime value={preview.at} /> : undefined}
          footer={
            /* Q84（项 1）：不再展示「照片预览（只读）」标题；「在 Immich 中打开」改 icon 按钮 */
            <IconAction label="在 Immich 中打开" tooltip="在 Immich 中打开原片" href={preview.href}>
              <IconExternalLink size={16} />
            </IconAction>
          }
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setPreview(null)}
        >
          <div className="wb-gallery__placeholder wb-gallery__placeholder--wide">
            <IconPhotoOff size={28} aria-hidden />
            <Text size="xs" c="dimmed" ta="center">
              缩略图不可用 —— 可到 Immich 中查看原片
            </Text>
          </div>
        </MediaLightbox>
      )}
    </div>
  );
}
