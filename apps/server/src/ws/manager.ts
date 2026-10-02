import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP } from "node:net";
import { WebSocket } from "ws";

import { config } from "../config.ts";
import { loadSourceConfig, resolveSecretRefs, type FetchContext } from "../connector/registry.ts";
import { assertSafeOutboundUrl } from "../connector/ssrf.ts";
import { readSecret } from "../credentials/store.ts";
import type { Db } from "../db/client.ts";
import { dataSource } from "../db/schema.ts";
import type { EventBus } from "../data/events.ts";
import { eq } from "drizzle-orm";

/**
 * WS 数据源管理器（**批H3 / Q77，D56**）：服务端 WS 客户端连用户源，消息经现有
 * `/api/events` SSE 转发（`ws:<sourceId>` topic + payload）—— 前端传输层保持 HTTP+SSE 不变。
 *
 * - **出站基线**：`assertSafeOutboundUrl`（SSRF 协议/内网判定 + **SEC-3 IP 钉死**：
 *   自定义 `lookup` 把连接固定到已验证地址）；凭证经 headers 注入（SEC3，解析在调用侧）。
 * - **生命周期**：`sync()` 对账连接（新增/变更即重连、删除即断开）；异常断开**指数退避重连**
 *   （1s→30s 封顶）；`stop()` 全部断开且不再重连（进程退出/热替换用）。
 */
export interface WsSourceRow {
  id: string;
  url: string;
  headers: Record<string, string>;
}

interface Conn {
  ws: WebSocket;
  row: WsSourceRow;
  retryMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export class WsSourceManager {
  private conns = new Map<string, Conn>();

  private bus: EventBus;
  private opts: { allowPrivate?: boolean; log?: (msg: string) => void };

  constructor(bus: EventBus, opts: { allowPrivate?: boolean; log?: (msg: string) => void } = {}) {
    this.bus = bus;
    this.opts = opts;
  }

  /** 对账：rows 是期望状态（全量）。新增/变更连接、消失断开。 */
  async sync(rows: WsSourceRow[]): Promise<void> {
    const wanted = new Map(rows.map((r) => [r.id, r]));
    for (const [id, conn] of this.conns) { // Map 迭代中删当前项安全（no-useless-spread）
      const keep = wanted.get(id);
      if (!keep || keep.url !== conn.row.url || JSON.stringify(keep.headers) !== JSON.stringify(conn.row.headers)) {
        conn.closed = true;
        if (conn.timer) clearTimeout(conn.timer);
        conn.ws.close();
        this.conns.delete(id);
      }
    }
    for (const row of rows) {
      if (!this.conns.has(row.id)) await this.connect(row);
    }
  }

  /** 全停（不再重连）。 */
  stop(): void {
    for (const conn of this.conns.values()) {
      conn.closed = true;
      if (conn.timer) clearTimeout(conn.timer);
      conn.ws.close();
    }
    this.conns.clear();
  }

  private async connect(row: WsSourceRow): Promise<void> {
    let pinned: string | null = null;
    try {
      // SEC-3：校验与连接目标绑定 —— ws/wss 同走 SSRF 基线（协议白名单 + 内网判定）
      // SEC4：与 outboundRequest 同语义 —— ALLOW_PRIVATE_OUTBOUND=1（E2E/内网场景）才放行内网
      const safe = await assertSafeOutboundUrl(row.url, this.opts.allowPrivate ?? config.allowPrivateOutbound);
      pinned = safe.pinnedIp;
    } catch (e) {
      this.opts.log?.(`[ws] ${row.id} 目标被拒：${e instanceof Error ? e.message : String(e)}`);
      return; // 校验不过 = 不建连（fail-closed），不进重连循环
    }

    const secure = row.url.startsWith("wss:");
    const lookupPinned = pinned
      ? (_h: string, _o: unknown, cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) =>
          cb(null, pinned, isIP(pinned) === 6 ? 6 : 4)
      : undefined;
    const agent = secure
      ? new HttpsAgent({ lookup: lookupPinned, keepAlive: false })
      : new HttpAgent({ lookup: lookupPinned, keepAlive: false });

    const ws = new WebSocket(row.url, { headers: row.headers, agent, handshakeTimeout: 10_000 });
    const conn: Conn = { ws, row, retryMs: 1_000, timer: null, closed: false };
    this.conns.set(row.id, conn);

    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        /* 非 JSON 载荷原样转发 */
      }
      this.bus.publish(`ws:${row.id}`, payload);
    });
    ws.on("error", (err) => {
      this.opts.log?.(`[ws] ${row.id} 连接错误：${err.message}`);
    });
    ws.on("close", () => {
      if (conn.closed) return;
      // 指数退避重连（1s→30s 封顶）
      conn.timer = setTimeout(() => {
        if (!conn.closed) void this.connect(row);
      }, conn.retryMs);
      conn.retryMs = Math.min(conn.retryMs * 2, 30_000);
    });
  }
}

/** 从数据连接表装载 ws 类连接（凭证解析 SEC3、配置损坏跳过 —— SRV-07 口径：可见报错在管理面）。 */
export async function loadWsSourceRows(db: Db): Promise<WsSourceRow[]> {
  const rows = await db.select().from(dataSource).where(eq(dataSource.kind, "ws"));
  const out: WsSourceRow[] = [];
  for (const r of rows) {
    const ctx: FetchContext = {
      db,
      userId: r.userId,
      readSecret: (cid: string) => readSecret(db, r.userId, cid),
    };
    const cfg = await resolveSecretRefs(loadSourceConfig(r.configJson), ctx);
    const url = typeof cfg.url === "string" ? cfg.url : "";
    if (!url) continue;
    const headers: Record<string, string> = {};
    const token = typeof cfg.apiToken === "string" ? cfg.apiToken : "";
    const authHeader = typeof cfg.authHeader === "string" ? cfg.authHeader.trim() : "";
    if (token) headers[authHeader || "Authorization"] = authHeader ? token : `Bearer ${token}`;
    out.push({ id: r.id, url, headers });
  }
  return out;
}
