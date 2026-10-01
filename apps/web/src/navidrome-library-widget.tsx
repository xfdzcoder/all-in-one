import { IconPlayerPause, IconPlayerPlay, IconPlayerSkipBack, IconPlayerSkipForward, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { Badge, Group, Modal, Text } from "@mantine/core";

import { useNavidromeControl, useNavidromeLibrary } from "./data-hooks";
import { ServiceIcon } from "./service-icon";
import { useDataSources } from "./data-hooks";
import { WbAlert, WbLoading, IconAction } from "./ui";

/**
 * Navidrome 专辑墙（FR-X3 只读深度，**D50**）：最近添加专辑网格 + 正在播放。
 * 封面由服务端代取为 data URI（Subsonic 认证不进前端 SEC3）；只读 —— 无播放控制（FR-X3b 待拍板）。
 */
export function NavidromeLibraryWidget({
  sourceId,
  limit = 12,
  refreshSec,
}: {
  sourceId?: string;
  limit?: number;
  refreshSec?: number;
}) {
  const { data, loading, error, refresh } = useNavidromeLibrary(sourceId, limit, refreshSec);
  const control = useNavidromeControl(sourceId);
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

      {sourceId && (
        <div className="wb-svc-notes">
          <Group gap={6}>
            {(
              [
                ["prev", "上一首", IconPlayerSkipBack],
                ["play", "播放", IconPlayerPlay],
                ["pause", "暂停", IconPlayerPause],
                ["next", "下一首", IconPlayerSkipForward],
                ["stop", "停止", IconPlayerStop],
              ] as const
            ).map(([act, label, Icon]) => (
              <IconAction key={act} label={label} disabled={control.busy} onClick={() => control.send(act)}>
                <Icon size={14} />
              </IconAction>
            ))}
          </Group>
          <Text size="xs" c="dimmed">
            遥控作用于服务器当前播放会话（多设备收听会互相干扰，单设备场景为宜）
          </Text>
          {control.error && <WbAlert tone="error" size="sm">{control.error}</WbAlert>}
        </div>
      )}

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
        <div className="wb-gallery">
          {data.albums.map((a) => (
            <button
              key={a.id}
              type="button"
              className="wb-gallery__cell"
              title={`${a.name}${a.artist ? ` · ${a.artist}` : ""}`}
              onClick={() => setPreview({ cover: a.cover, name: a.name, artist: a.artist })}
            >
              <img src={a.cover} alt="" loading="lazy" />
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
        <Modal opened onClose={() => setPreview(null)} title={`${preview.name}${preview.artist ? ` · ${preview.artist}` : ""}`} size="md">
          <img
            src={preview.cover}
            alt=""
            style={{ maxWidth: "100%", borderRadius: 8, display: "block", margin: "0 auto" }}
          />
          <Text size="xs" c="dimmed" mt="sm" ta="center">
            只读展示 —— 播放控制属写操作（FR-X3b 待拍板）
          </Text>
        </Modal>
      )}
    </div>
  );
}
