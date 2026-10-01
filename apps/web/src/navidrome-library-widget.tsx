import { IconDiscOff, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { Badge, Group, Modal, Text } from "@mantine/core";

import { useNavidromeLibrary } from "./data-hooks";
import { MediaWall } from "./media-wall";
import { ServiceIcon } from "./service-icon";
import { useDataSources } from "./data-hooks";
import { WbAlert, WbLoading, IconAction } from "./ui";

/**
 * Navidrome 专辑墙（FR-X3 只读深度，**D50**）：最近添加专辑 + 正在播放。
 * 封面由服务端代取为 data URI（Subsonic 认证不进前端 SEC3）。
 * **D54**：播放遥控（FR-X3e）已移除 —— 本组件回归纯只读，无任何写操作。
 */
export function NavidromeLibraryWidget({
  sourceId,
  limit = 12,
  refreshSec,
  layout = "grid",
  randomIntervalSec = 30,
  minCell = 72,
}: {
  sourceId?: string;
  limit?: number;
  refreshSec?: number;
  /** Q71（项 6）：`grid` 铺开 / `random` 随机单图定时换。 */
  layout?: "grid" | "random";
  randomIntervalSec?: number;
  /** 格子最小边长 px（只限最小、不限最大）。 */
  minCell?: number;
}) {
  const { data, loading, error, refresh } = useNavidromeLibrary(sourceId, limit, refreshSec);
  const [preview, setPreview] = useState<{ cover: string; name: string; artist?: string } | null>(null);
  const all = useDataSources();
  const row = (all.data ?? []).find((r: { id: string }) => r.id === sourceId);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <ServiceIcon name="navidrome" size={16} />
        <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
          专辑墙{row?.name ? ` · ${row.name}` : ""}
        </Text>
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>

      {!sourceId && (
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加 Navidrome 连接
          </Text>
        </div>
      )}
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}

      {(data?.nowPlaying ?? []).length > 0 && (
        <div className="wb-svc-notes">
          {(data?.nowPlaying ?? []).map((p, i) => (
            <Text key={i} size="xs">
              <Badge size="compact-xs" color="green" variant="light" mr={6}>
                正在播放
              </Badge>
              {p.title}
              {p.artist ? ` · ${p.artist}` : ""}
              {p.username ? `（${p.username}）` : ""}
            </Text>
          ))}
        </div>
      )}

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
            placeholder: { icon: <IconDiscOff size={18} aria-hidden />, label: "封面不可用" },
          }))}
          layout={layout}
          randomIntervalSec={randomIntervalSec}
          minCell={minCell}
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
        <Modal opened onClose={() => setPreview(null)} title={`${preview.name}${preview.artist ? ` · ${preview.artist}` : ""}`} size="md">
          {preview.cover ? (
            <img
              src={preview.cover}
              alt=""
              style={{ maxWidth: "100%", borderRadius: 8, display: "block", margin: "0 auto" }}
            />
          ) : (
            /* Q70：封面不可用（真机常见：封面原图过大）—— 明说原因 */
            <div className="wb-gallery__placeholder wb-gallery__placeholder--wide">
              <IconDiscOff size={28} aria-hidden />
              <Text size="xs" c="dimmed" ta="center">
                封面不可用
              </Text>
            </div>
          )}
          <Text size="xs" c="dimmed" mt="sm" ta="center">
            只读展示 —— 播放控制属写操作，已于 D54 移除
          </Text>
        </Modal>
      )}
    </div>
  );
}
