import { IconRefresh, IconInfoCircle } from "./icons";
import { useMemo, useState } from "react";
import { Badge, Card, Group, JsonInput, Modal, Stack, Text } from "@mantine/core";

import { isServiceOverview, validateServiceOverview } from "@all-in-one/widget-sdk";
import type { ServiceListItem, ServiceMetric, ServiceOverview } from "@all-in-one/widget-sdk";

import { useServiceOverview, useSourceMeta } from "./data-hooks";
import { WidgetTitle } from "./widget-title";
import { ServiceIcon } from "./service-icon";
import { SourceHint, WbAlert, WbLoading, IconAction } from "./ui";
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
  const [lastSample, setLastSample] = useState<ServiceOverview["sample"]>(undefined);
  // react(set-state-in-effect)：改为**渲染期派生**（React 官方「storing information from previous
  // renders」模式，state 比较而非 ref —— ref-in-render 会被 react(refs) 抓）；严格模式双渲染幂等。
  if (sample && sample !== lastSample) {
    setLastSample(sample);
    setSamples((prev) => {
      const t = Date.parse(sample.at);
      const ts = Number.isFinite(t) ? t : Date.now();
      const last = prev[prev.length - 1];
      if (last && ts - last.t < 500) return prev; // 去抖（同一次轮询的重复渲染）
      return [...prev, { t: ts, series: sample.series }].slice(-TREND_MAX);
    });
  }

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
              <Text size="xs" c="dimmed" truncate className="wb-flex-1">
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
  // 连接 kind → 官方图标（画廊同款）；WEB-12：连接元信息一次订阅（Q86/D59 标题跳转）
  const { row, homeUrl } = useSourceMeta(undefined, sourceId);
  const kindIcon: Record<string, string> = {
    immich: "immich",
    navidrome: "navidrome",
    portainer: "portainer",
    mihomo: "mihomo",
    monitor: "glances",
    http: "",
  };

  // LNT-2：原 `as unknown as` 双重断言会静默吞掉形状漂移 —— 先过契约校验再收窄
  //（validateServiceOverview 来自 widget-sdk；校验失败留在控制台，渲染仍按已知字段走）
  const ov = useMemo<ServiceOverview | undefined>(() => {
    const raw: unknown = data;
    if (raw === undefined || raw === null) return undefined;
    // LNT-2：类型守卫收窄（零断言）—— 形状漂移时有明确信号（控制台 + 空态），不再静默吞
    if (!isServiceOverview(raw)) {
      console.error("[service-overview] 契约校验失败：", validateServiceOverview(raw));
      return undefined;
    }
    return raw;
  }, [data]);
  const trend = useTrend(ov?.sample);

  const primary = ov?.metrics?.find((m) => m.emphasis);
  const secondary = (ov?.metrics ?? []).filter((m) => !m.emphasis);

  return (
    <div className="wb-widget">
      <WidgetTitle
        icon={row && kindIcon[row.kind] ? <ServiceIcon name={kindIcon[row.kind]} size={16} /> : null}
        title={row?.name ?? "服务概览"}
        href={homeUrl}
        actions={
          <>
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
          </>
        }
      />

      {!sourceId && (
        <SourceHint text="暂未选择数据连接 —— 请到「数据源管理 · 数据连接」添加服务连接" actionLabel="去添加连接" />
      )}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {ov && !ov.probe?.ok && (
        <WbAlert tone="warning" size="sm">
          无法读取服务：{ov.probe?.error ?? "未知原因"}
        </WbAlert>
      )}
      {loading && <WbLoading />}
      {ov?.probe?.ok && (
        <Stack gap={6} className="wb-scroll-area">
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
