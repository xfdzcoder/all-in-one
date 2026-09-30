import { createHash } from "node:crypto";

import type { Db } from "../db/client.ts";
import type { SecretRef } from "@all-in-one/widget-sdk";
import { isSecretRef } from "@all-in-one/widget-sdk";
import { assertSafeOutboundUrl } from "./ssrf.ts";
import { config } from "../config.ts";

/**
 * FR-W3 数据通道：Widget 声明数据源 → 服务端 connector 代取。
 * 前端永不直连第三方；凭证注入在服务端完成（SEC3）。
 */

/** Widget 数据查询（来自 POST /api/widgets/data）。 */
export interface WidgetDataQuery {
  /** widget 类型（manifest.type），决定用哪个 connector。 */
  type: string;
  /** widget 配置（configSchema 校验后的值；secret 字段为 SecretRef）。 */
  config: Record<string, unknown>;
}

export interface FetchContext {
  db: Db;
  userId: string;
  /** 取解密凭证（仅供 connector 组装请求）。 */
  readSecret: (credentialId: string) => Promise<string | null>;
}

export interface WidgetConnector {
  type: string;
  fetch(query: WidgetDataQuery, ctx: FetchContext): Promise<unknown>;
}

export class UnknownWidgetTypeError extends Error {
  constructor(type: string) {
    super(`no connector registered for widget type: ${type}`);
    this.name = "UnknownWidgetTypeError";
  }
}

/** 把配置中的 SecretRef 解析为明文（仅在 connector 内部使用）。 */
export async function resolveSecretRefs(
  config: Record<string, unknown>,
  ctx: FetchContext,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (isSecretRef(v)) {
      out[k] = await ctx.readSecret((v as SecretRef).credentialRef);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createConnectorRegistry() {
  const map = new Map<string, WidgetConnector>();
  return {
    register(connector: WidgetConnector) {
      map.set(connector.type, connector);
    },
    get(type: string): WidgetConnector {
      const c = map.get(type);
      if (!c) throw new UnknownWidgetTypeError(type);
      return c;
    },
    has: (type: string) => map.has(type),
  };
}

export type ConnectorRegistry = ReturnType<typeof createConnectorRegistry>;

/** 缓存 key：type + config 的稳定哈希（config 含 SecretRef 不含明文，安全）。 */
export function cacheKeyOf(query: WidgetDataQuery): string {
  return createHash("sha256")
    .update(query.type)
    .update("\u0000")
    .update(JSON.stringify(query.config, Object.keys(query.config).sort()))
    .digest("hex");
}

/** 供 http-connector 复用的出站 GET/POST 封装（SSRF + 超时 + 体积上限）。
 *  allowPrivate：服务聚合场景（app-launcher/OpenCode/监控源）目标即内网服务（D22/D32/D36）。 */
export async function outboundRequest(
  rawUrl: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
    allowPrivate?: boolean;
  } = {},
): Promise<{ status: number; text: string }> {
  const url = await assertSafeOutboundUrl(rawUrl, opts.allowPrivate ?? config.allowPrivateOutbound);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      redirect: "manual", // 不跟随跳转，防 redirect 到内网绕过 SSRF 检查
    });
    const maxBytes = opts.maxBytes ?? 1_000_000;
    const text = await res.text();
    if (text.length > maxBytes) {
      throw new Error(`response too large (> ${maxBytes} bytes)`);
    }
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}
