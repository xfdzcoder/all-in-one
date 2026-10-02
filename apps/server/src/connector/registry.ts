import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

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

/** SRV-07：连接配置解析 —— 解析失败必须说「原因 + 怎么修」（D47）。
 *  此前 10 处静默 catch（noop）把**库里损坏的配置**吞成 `{}`，对外误报「连接缺少地址」——
 *  用户照提示补地址永远修不好（真实原因是 configJson 损坏）。 */
export function loadSourceConfig(
  configJson: string,
  label = "数据连接",
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    throw new Error(
      `${label}的配置已损坏（JSON 解析失败）—— 请在「数据源管理 · 数据连接」打开该连接、重新填写并保存一次配置`,
      { cause: err },
    );
  }
}

/** 把配置中的 SecretRef 解析为明文（仅在 connector 内部使用）。 */
export async function resolveSecretRefs(
  rawConfig: Record<string, unknown>, // 不叫 rawConfig：遮蔽全局 app rawConfig（no-shadow 真混淆源）
  ctx: FetchContext,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawConfig)) {
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

/** 稳定序列化：对象键排序 + **递归嵌套**。
 *  原实现用 `JSON.stringify(config, Object.keys(config).sort())` 的 replacer 数组 ——
 *  它只认**顶层**键，嵌套对象（SecretRef `{type,credentialRef}`、app-launcher `items[]`…）
 *  全被序列化成 `{}` ⇒ 只差嵌套字段的两个配置算出同一个缓存键（SRV-03/SEC-5：60s 内把
 *  A 配置的数据回给 B）。 */
function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).toSorted();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** SRV-29：**小并发映射** —— 串行 `for…await` 逐张抓缩略图，上游普遍超时时单个请求
 *  最坏可挂十几分钟。并发上限 + 总时间预算：预算耗尽后未开始的项**直接跳过**（调用方按
 *  「未取到」处理并给出原因），不再打上游。返回与入参等长的结果数组。 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  opts: { budgetMs?: number } = {},
): Promise<Array<R | null>> {
  const out: Array<R | null> = Array.from({ length: items.length }, () => null); // unicorn(no-new-array)
  const deadline = opts.budgetMs !== undefined ? Date.now() + opts.budgetMs : Infinity;
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      if (Date.now() > deadline) return; // 预算耗尽：剩余项跳过（保持 null）
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 缓存 key：type + config 的稳定哈希（config 含 SecretRef 不含明文，安全）。 */
export function cacheKeyOf(query: WidgetDataQuery): string {
  return createHash("sha256")
    .update(query.type)
    .update("\u0000")
    .update(stableStringify(query.config))
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
): Promise<{ status: number; text: string; bytes: Uint8Array }> {
  const { url, pinnedIp } = await assertSafeOutboundUrl(
    rawUrl,
    opts.allowPrivate ?? config.allowPrivateOutbound,
  );
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const isHttps = url.protocol === "https:";
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");

  // SEC-3：**按已验证 IP 建连** —— fetch 会自行再解析 DNS（校验与连接目标解绑 →
  // DNS rebinding 的 TOCTOU 窗口）。core http(s).request 的 `lookup` 直接回填验证过的地址；
  // SNI / 证书校验仍按原 hostname（host 头不变），功能语义与 fetch 一致。
  // `accept-encoding: identity`：fetch 原本自动解压，裸流不解 —— 显式要原文（连接器只吃纯文本/JSON）。
  const lookupPinned = pinnedIp
    ? (_h: string, _o: unknown, cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) =>
        cb(null, pinnedIp, isIP(pinnedIp) === 6 ? 6 : 4)
    : undefined;

  return await new Promise<{ status: number; text: string; bytes: Uint8Array }>((resolve, reject) => {
    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: opts.method ?? "GET",
        // redirect 永不跟随（http.request 天然不跟）—— 防 redirect 到内网绕过 SSRF 检查
        headers: { accept: "*/*", "accept-encoding": "identity", ...opts.headers, host: url.host },
        lookup: lookupPinned,
      },
      (res) => {
        // SEC-2/SRV-04：**边读边判** —— 整包进内存再判大小等于没限（恶意上游回 2GB 先打爆内存）
        const chunks: Uint8Array[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.byteLength;
          if (total > maxBytes) {
            res.destroy();
            reject(new Error(`response too large (> ${maxBytes} bytes)`));
            return;
          }
          chunks.push(new Uint8Array(c));
        });
        res.on("end", () => {
          const bytes = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            bytes.set(c, off);
            off += c.byteLength;
          }
          resolve({ status: res.statusCode ?? 0, text: new TextDecoder().decode(bytes), bytes });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
