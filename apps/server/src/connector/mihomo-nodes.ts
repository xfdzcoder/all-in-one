import { dataSource } from "../db/schema.ts";
import { eq } from "drizzle-orm";

import type { FetchContext, WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * Mihomo 节点面板（FR-X3 只读深度，**D50**）：策略组选择 / 节点延迟 / 订阅源详情。
 * - `GET /proxies`（组 now + 节点 alive + history 延迟）、`GET /providers/proxies`（订阅源）；
 * - 只读边界（D50）：无代理切换/重载配置（写操作待拍板，FR-X3b）。
 */

export interface MihomoNodeItem {
  name: string;
  type?: string;
  alive?: boolean;
  /** 最近延迟（ms，history 尾点）。 */
  delayMs?: number;
}

export interface MihomoGroupItem {
  name: string;
  now?: string;
  members: number;
  /** 可切换成员（Q57 切换弹层用）。 */
  options: string[];
}

export interface MihomoProviderItem {
  name: string;
  nodes: number;
  updatedAt?: string;
}

export interface MihomoNodesData {
  groups: MihomoGroupItem[];
  nodes: MihomoNodeItem[];
  providers: MihomoProviderItem[];
  notes?: string[];
}

const TIMEOUT_MS = 8000;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 归一：/proxies + /providers/proxies（可单测）。 */
export function normalizeMihomoNodes(proxies: unknown, providers: unknown): Omit<MihomoNodesData, "notes"> {
  const px = ((proxies ?? {}) as Record<string, unknown>).proxies as
    | Record<string, Record<string, unknown>>
    | undefined;
  const groups: MihomoGroupItem[] = [];
  const nodes: MihomoNodeItem[] = [];
  for (const [name, p] of Object.entries(px ?? {})) {
    const all = Array.isArray(p.all) ? (p.all as unknown[]) : undefined;
    if (all && p.now) {
      groups.push({ name, now: str(p.now), members: all.length, options: all.map(String) });
      continue;
    }
    const hist = Array.isArray(p.history) ? (p.history as Array<Record<string, unknown>>) : [];
    const last = hist[hist.length - 1];
    nodes.push({
      name,
      type: str(p.type),
      alive: typeof p.alive === "boolean" ? p.alive : undefined,
      delayMs: last ? num(last.delay) : undefined,
    });
  }
  const prov = ((providers ?? {}) as Record<string, unknown>).providers as
    | Record<string, Record<string, unknown>>
    | undefined;
  const providerList: MihomoProviderItem[] = Object.entries(prov ?? {}).map(([name, v]) => {
    const list = Array.isArray(v.proxies) ? (v.proxies as unknown[]) : [];
    return {
      name,
      nodes: list.length,
      updatedAt: str(v.updatedAt),
    };
  });
  return { groups, nodes, providers: providerList };
}

export const mihomoNodesConnector: WidgetConnector = {
  type: "mihomo-nodes",
  async fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<MihomoNodesData> {
    const sourceId = typeof query.config.sourceId === "string" ? query.config.sourceId : "";
    if (!sourceId) throw new Error("未选择数据连接");
    const rows = await ctx.db.select().from(dataSource).where(eq(dataSource.id, sourceId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.userId) throw new Error("数据连接不存在");
    if (row.kind !== "mihomo") throw new Error(`节点面板需要 Mihomo 连接（当前：${row.kind}）`);
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(row.configJson) as Record<string, unknown>;
    } catch {
      /* noop */
    }
    const config = await resolveSecretRefs(rawConfig, ctx);
    const base = (str(config.url) ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("连接缺少地址");
    const headers = { Authorization: `Bearer ${str(config.secret) ?? ""}` };

    const res = await outboundRequest(`${base}/proxies`, {
      headers,
      timeoutMs: TIMEOUT_MS,
      maxBytes: 2_000_000,
      allowPrivate: true,
    });
    if (res.status >= 400) throw new Error(`mihomo API HTTP ${res.status}`);
    const proxies = JSON.parse(res.text);
    const notes: string[] = [];
    let providers: unknown = {};
    try {
      const p = await outboundRequest(`${base}/providers/proxies`, {
        headers,
        timeoutMs: TIMEOUT_MS,
        maxBytes: 1_000_000,
        allowPrivate: true,
      });
      if (p.status < 400) providers = JSON.parse(p.text);
    } catch (err) {
      notes.push(`订阅源获取失败：${err instanceof Error ? err.message : "未知错误"} —— 该项暂缺`);
    }
    return { ...normalizeMihomoNodes(proxies, providers), ...(notes.length > 0 ? { notes } : {}) };
  },
};
