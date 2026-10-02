import { IconExternalLink, IconPhotoOff, IconRefresh } from "./icons";
import { useState } from "react";
import { Badge, Text } from "@mantine/core";

import { useImmichGallery, useImmichPreview, useMediaOptionLabel, useSourceMeta } from "./data-hooks";
import { MediaLightbox } from "./media-lightbox";
import { MediaWall } from "./media-wall";
import { WidgetTitle } from "./widget-title";
import { ServiceIcon } from "./service-icon";
import { RelativeTime, SourceHint, WbAlert, WbLoading, IconAction } from "./ui";

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
  rowHeight = 72,
  /** @deprecated QA-002：旧键（语义已是「目标行高」），仅迁移期双读 */
  minCell,
  albumId,
}: {
  sourceId?: string;
  limit?: number;
  refreshSec?: number;
  /** Q71（项 6）：`grid` 铺开 / `random` 随机单图定时换。 */
  layout?: "grid" | "random";
  randomIntervalSec?: number;
  /** Q89（D60 §3）/ QA-002：**目标行高** px —— 行高由等比装箱反推，不再「只限最小、
   *  不限最大」地撑满卡片。配置键已迁 `rowHeight`；`minCell` 仅迁移期双读。 */
  rowHeight?: number;
  /** @deprecated QA-002：旧键双读 */
  minCell?: number;
  /** Q72/Q87：只看某个相册（留空 = 全部）。 */
  albumId?: string;
}) {
  const { data, loading, error, refresh } = useImmichGallery(sourceId, limit, refreshSec, albumId);
  const [preview, setPreview] = useState<{ id: string; thumb: string; href: string; at: string } | null>(null);
  // Q73（项 8）：铺开模式预览支持左右切换（循环）
  const [previewIdx, setPreviewIdx] = useState(0);
  const step = (d: number) => {
    const items = data?.items ?? [];
    if (items.length === 0) return;
    const next = (previewIdx + d + items.length) % items.length;
    setPreviewIdx(next);
    const it = items[next];
    setPreview({ id: it.id, thumb: it.thumb, href: it.href, at: it.at });
  };
  // Q105（用户反馈④）：灯箱**预览大图** —— 点开按需取一张（缩略图先顶上，大图到了替换）。
  // 墙上缩略图实测仅 444×250，灯箱按原始像素呈现即「太小」；preview 为 2560×1440。
  const { data: big, error: bigError } = useImmichPreview(sourceId, preview?.id);
  // WEB-12：连接元信息一次订阅（Q86/D59 标题区跳转到 Immich 站点）
  const { row, homeUrl } = useSourceMeta(undefined, sourceId);
  // Q94（反馈④）：标题带上**所选相册名**（配置只存 id，这里解析成名称）
  // WEB-10：只订阅「相册选项」一个查询（原先 useDynamicOptionsMap 会拉 12+ 个查询）
  const albumLabel = useMediaOptionLabel(albumId ? "immich-albums" : undefined, sourceId, albumId);

  return (
    <div className="wb-widget">
      <WidgetTitle
        icon={<ServiceIcon name="immich" size={16} />}
        title={
          <>
            照片墙{row?.name ? ` · ${row.name}` : ""}
            {albumLabel ? ` · ${albumLabel}` : ""}
          </>
        }
        href={homeUrl}
        actions={<IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>}
      />

      {!sourceId && <SourceHint text="暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加 Immich 连接" />}
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
          targetRowHeight={rowHeight ?? minCell ?? 72}
          onOpen={(it, i) => {
            setPreviewIdx(i);
            const src = data.items.find((x) => x.id === it.id);
            if (src) setPreview({ id: src.id, thumb: src.thumb, href: src.href, at: src.at });
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
          // Q105（用户反馈④）：优先预览大图（到货即替换墙上的小缩略图）；取不到回落缩略图并说明
          src={(big?.src ?? "") || preview.thumb || undefined}
          meta={
            <>
              {preview.at ? <RelativeTime value={preview.at} /> : null}
              {(bigError || big?.fallback) && (
                <Text size="xs" c="dimmed">
                  {" "}
                  · 预览大图不可用，显示缩略图 —— 可到 Immich 看原片
                </Text>
              )}
            </>
          }
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
