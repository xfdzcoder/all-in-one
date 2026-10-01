import { IconRefresh, IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Group, JsonInput, Modal, Stack, Text } from "@mantine/core";

import type { ServiceListItem, ServiceMetric, ServiceOverview } from "@all-in-one/widget-sdk";

import { useServiceOverview, useSourceHomeUrl } from "./data-hooks";
import { WidgetTitle } from "./widget-title";
import { ServiceIcon } from "./service-icon";
import { useDataSources } from "./data-hooks";
import { WbAlert, WbLoading, IconAction } from "./ui";
import { RelativeTime } from "./ui";

/**
 * 服务概览组件（Q39/D46 接入 · **Q44/D48 结构化重做**）：
 * 主指标 / 次指标 / 状态徽标 / 清单（异常置顶）/ 迷你趋势 + 诚实降级说明（notes）。
 * 指标按 research/00-service-metrics.md「用户期望指标清单」推导；只做连接与展示。
 */

const TREND_MAX = 30;

type Sample = { t: number; series: Record<string, number> };

/**
 * 迷你趋势（D48）：客户端累积轮询采样点；累计量（名字以 Total 结尾）做差分得速率。
 * 无历史接口、不改 schema —— 服务端只回本次采样点。
 */
function useTrend(sample: ServiceOverview["sample"]): Array<{ key: string; label: string; points: number[] }> {
  const [samples, setSamples] = useState<Sample[]>([]);
  useEffect(() => {
    if (!sample) return;
    setSamples((prev) => {
      const t = Date.parse(sample.at);
      const ts = Number.isFinite(t) ? t : Date.now();
      const last = prev[prev.length - 1];
      if (last && ts - last.t < 500) return prev; // 去抖（同一次轮询的重复渲染）
      return [...prev, { t: ts, series: sample.series }].slice(-TREND_MAX);
    });
  }, [sample]);

  return useMemo(() => {
    if (samples.length < 2) return [];
    const keys = Object.keys(samples[0].series);
    const out: Array<{ key: string; label: string; points: number[] }> = [];
    for (const key of keys) {
      const points: number[] = [];
      for (let i = 1; i < samples.length; i++) {
        const dt = (samples[i].t - samples[i - 1].t) / 1000;
        const dv = samples[i].series[key] - samples[i - 1].series[key];
        points.push(key.endsWith("Total") ? (dt > 0 ? Math.max(0, dv) / dt : 0) : samples[i].series[key]);
      }
      const label = key.endsWith("Total")
        ? `${key.startsWith("down") ? "下行" : "上行"}速率`
        : key === "connections"
          ? "活动连接"
          : key;
      out.push({ key, label, points });
    }
    return out;
  }, [samples]);
}

/** 极简 sparkline（无第三方图表依赖）。 */
function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const w = 120;
  const h = 22;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (p / max) * (h - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="wb-sparkline" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function fmtSeries(key: string, v: number): string {
  if (key.endsWith("Total")) {
    // 速率（bytes/s）→ 人类可读
    if (v >= 2 ** 20) return `${(v / 2 ** 20).toFixed(1)} MB/s`;
    if (v >= 2 ** 10) return `${(v / 2 ** 10).toFixed(0)} KB/s`;
    return `${v.toFixed(0)} B/s`;
  }
  return v.toFixed(0);
}

function MetricCard({ m, primary }: { m: ServiceMetric; primary?: boolean }) {
  return (
    <Card withBorder padding="xs" radius="sm" className={primary ? "wb-metric wb-metric--primary" : "wb-metric"}>
      <div className="wb-metric__label">{m.label}</div>
      <div className={primary ? "wb-metric__value wb-metric__value--display" : "wb-metric__value"}>{m.value}</div>
      {m.hint && <div className="wb-metric__hint">{m.hint}</div>}
    </Card>
  );
}

function ListBlock({ list }: { list: { title: string; items: ServiceListItem[] } }) {
  return (
    <div className="wb-svc-list">
      <Text size="xs" fw={600} c="dimmed">
        {list.title}
      </Text>
      <Stack gap={2}>
        {list.items.length === 0 && (
          <Text size="xs" c="dimmed">
            暂无
          </Text>
        )}
        {list.items.map((it, i) => (
          <Group key={`${it.title}-${i}`} gap={6} wrap="nowrap">
            <Text size="xs" truncate fw={it.tone === "error" ? 700 : 400} className={it.tone === "error" ? "wb-text--danger" : undefined}>
              {it.title}
            </Text>
            {it.detail && (
              <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
                {it.detail}
              </Text>
            )}
            {it.at && (
              <Text size="xs" c="dimmed">
                <RelativeTime value={it.at} />
              </Text>
            )}
          </Group>
        ))}
      </Stack>
    </div>
  );
}

export function ServiceOverviewWidget({ sourceId, refreshSec }: { sourceId?: string; refreshSec?: number }) {
  const { data, loading, error, refresh } = useServiceOverview(sourceId, refreshSec);
  const [detailOpen, setDetailOpen] = useState(false);
  // 连接 kind → 官方图标（画廊同款）
  const all = useDataSources();
  const row = (all.data ?? []).find((r: { id: string }) => r.id === sourceId);
  // Q86/D59：标题区跳转到该数据源站点
  const homeUrl = useSourceHomeUrl(sourceId);
  const kindIcon: Record<string, string> = {
    immich: "immich",
    navidrome: "navidrome",
    portainer: "portainer",
    mihomo: "mihomo",
    monitor: "glances",
    opencode: "opencode",
    http: "",
  };

  const ov = data as unknown as ServiceOverview | undefined;
  const trend = useTrend(ov?.sample);

  // Q69：`diagnostics` 只进开发者控制台、不渲染进卡片（典型：mihomo `/memory` 在反代下被
  // 缓冲/挂起，实测 This operation was aborted）。开发期保留该通道便于排查，稳定后清理（见 07 待办）。
  const diagKey = JSON.stringify(ov?.diagnostics ?? []);
  useEffect(() => {
    for (const d of JSON.parse(diagKey) as string[]) console.error("[service-overview]", d);
  }, [diagKey]);

  const primary = ov?.metrics?.find((m) => m.emphasis);
  const secondary = (ov?.metrics ?? []).filter((m) => !m.emphasis);

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <WidgetTitle
          icon={row && kindIcon[row.kind] ? <ServiceIcon name={kindIcon[row.kind]} size={16} /> : null}
          title={row?.name ?? "服务概览"}
          href={homeUrl}
        />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          {ov?.probe?.ok && (
            <Badge size="xs" color="green" variant="light">
              {ov.probe.version ? `v${ov.probe.version}` : "已连接"}
            </Badge>
          )}
          {ov && !ov.probe?.ok && (
            <Badge size="xs" color="red" variant="light">
              探测失败
            </Badge>
          )}
          {ov && (
            <IconAction label="详情" onClick={() => setDetailOpen(true)}><IconInfoCircle size={14} /></IconAction>
          )}
          <IconAction label="刷新" onClick={() => void refresh()}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>

      {!sourceId && (
        <div className="wb-widget__hint">
          <Text size="xs" c="dimmed">
            暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加服务连接
          </Text>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => window.dispatchEvent(new CustomEvent("wb:navigate", { detail: { tab: "sources" } }))}
          >
            去添加连接
          </Button>
        </div>
      )}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {ov && !ov.probe?.ok && (
        <WbAlert tone="warning" size="sm">
          无法读取服务：{ov.probe?.error ?? "未知原因"}
        </WbAlert>
      )}
      {loading && <WbLoading />}
      {ov?.probe?.ok && (
        <Stack gap={6} style={{ flex: 1, overflow: "auto" }}>
          {(ov.statuses ?? []).length > 0 && (
            <Group gap={6}>
              {(ov.statuses ?? []).map((s, i) => (
                <Badge
                  key={i}
                  size="xs"
                  variant="light"
                  className="wb-status-badge"
                  color={s.tone === "ok" ? "green" : s.tone === "error" ? "red" : s.tone === "warn" ? "orange" : "blue"}
                >
                  {s.text}
                </Badge>
              ))}
            </Group>
          )}

          {primary && <MetricCard m={primary} primary />}
          {secondary.length > 0 && (
            /* Q69：3 列网格 —— 「活动连接 / 累计下行 / 累计上行」正好一行三个（窄卡经容器查询降列） */
            <div className="wb-metric-grid wb-metric-grid--3">
              {secondary.map((m) => (
                <MetricCard key={m.label} m={m} />
              ))}
            </div>
          )}

          {trend.length > 0 && (
            <div className="wb-svc-trend">
              {trend.slice(0, 2).map((s) => (
                <Group key={s.key} gap={6} wrap="nowrap">
                  <Text size="xs" c="dimmed" style={{ minWidth: 56 }}>
                    {s.label}
                  </Text>
                  <Sparkline points={s.points} />
                  <Text size="xs" fw={600} style={{ minWidth: 64, textAlign: "right" }}>
                    {fmtSeries(s.key, s.points[s.points.length - 1])}
                  </Text>
                </Group>
              ))}
            </div>
          )}

          {(ov.lists ?? []).map((l) => (
            <ListBlock key={l.title} list={l} />
          ))}

          {(ov.notes ?? []).length > 0 && (
            <div className="wb-svc-notes">
              {(ov.notes ?? []).map((n, i) => (
                <Text key={i} size="xs" c="dimmed">
                  · {n}
                </Text>
              ))}
            </div>
          )}

          {!primary && secondary.length === 0 && (ov.lists ?? []).length === 0 && (
            <Text size="xs" c="dimmed">
              已连接
            </Text>
          )}
        </Stack>
      )}

      {detailOpen && ov && (
        <Modal opened onClose={() => setDetailOpen(false)} title="详情 · 服务概览原始数据（FR-I4)" size="lg">
          <JsonInput value={JSON.stringify(ov, null, 2)} autosize minRows={6} maxRows={16} readOnly />
        </Modal>
      )}
    </div>
  );
}
