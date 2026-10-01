import { useState } from "react";
import { Badge, Button, Group, Modal, Text } from "@mantine/core";

import { useImmichGallery } from "./data-hooks";
import { ServiceIcon } from "./service-icon";
import { useDataSources } from "./data-hooks";
import { RelativeTime, WbAlert } from "./ui";

/**
 * Immich 照片墙（FR-X3 只读深度，**D50**）：最近照片网格。
 * 缩略图由服务端代取为 data URI（凭证不进前端 SEC3）；点击新标签开 Immich 原图页；
 * 只读 —— 无上传/删除/收藏等写操作（写操作类待拍板，FR-X3b）。
 */
export function ImmichGalleryWidget({
  sourceId,
  limit = 12,
  refreshSec,
}: {
  sourceId?: string;
  limit?: number;
  refreshSec?: number;
}) {
  const { data, loading, error, refresh } = useImmichGallery(sourceId, limit, refreshSec);
  const [preview, setPreview] = useState<{ thumb: string; href: string; at: string } | null>(null);
  const all = useDataSources();
  const row = (all.data ?? []).find((r: { id: string }) => r.id === sourceId);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <ServiceIcon name="immich" size={16} />
        <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
          照片墙{row?.name ? ` · ${row.name}` : ""}
        </Text>
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <Button size="compact-xs" variant="subtle" onClick={() => void refresh()}>
            刷新
          </Button>
        </Group>
      </Group>

      {!sourceId && (
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加 Immich 连接
          </Text>
        </div>
      )}
      {loading && (
        <Text size="xs" c="dimmed" className="wb-loading">
          加载中…
        </Text>
      )}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {data && data.items.length === 0 && !error && (
        <Text size="xs" c="dimmed">
          暂无照片
        </Text>
      )}
      {data && data.items.length > 0 && (
        <div className="wb-gallery">
          {data.items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="wb-gallery__cell"
              title={it.at ? new Date(it.at).toLocaleString("zh-CN") : undefined}
              onClick={() => setPreview({ thumb: it.thumb, href: it.href, at: it.at })}
            >
              <img src={it.thumb} alt="" loading="lazy" />
              {it.type === "VIDEO" && (
                <Badge size="compact-xs" className="wb-gallery__video" color="dark" variant="filled">
                  视频
                </Badge>
              )}
            </button>
          ))}
        </div>
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
        <Modal opened onClose={() => setPreview(null)} title="照片预览（只读）" size="lg">
          <img src={preview.thumb} alt="" style={{ maxWidth: "100%", borderRadius: 8, display: "block", margin: "0 auto" }} />
          <Group justify="space-between" mt="sm">
            <Text size="xs" c="dimmed">
              {preview.at && <RelativeTime value={preview.at} />}
            </Text>
            <Button
              size="compact-xs"
              component="a"
              href={preview.href}
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
            >
              在 Immich 中打开
            </Button>
          </Group>
        </Modal>
      )}
    </div>
  );
}
