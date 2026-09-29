import { isIP } from "node:net";
import { connect } from "node:net";
import { lookup } from "node:dns/promises";

import type { WidgetConnector, WidgetDataQuery } from "./registry.ts";
import { assertSafeOutboundUrl } from "./ssrf.ts";

/**
 * 应用入口 + 服务状态 connector（FR：HTTP/TCP 存活探测、跳转）。
 * 探测目标是**内网服务**（192.168.x、NAS、docker 面板等）——
 * 这正是本产品的核心场景，故此 connector 的探测走 allowPrivate 通道（D22），
 * 但仍限制协议/超时；跳转 URL 由前端直接打开，不经服务端。
 */

interface ProbeItem {
  name: string;
  url: string;
  /** "http" = GET/HEAD 探活；"tcp" = 端口连通；缺省按 URL 协议推断。 */
  probe?: "http" | "tcp";
}

function timeoutMs(): number {
  return 5000;
}

async function probeHttp(url: string): Promise<boolean> {
  try {
    const u = await assertSafeOutboundUrl(url, true); // D22: 内网探测
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const res = await fetch(u, { method: "GET", signal: controller.signal, redirect: "manual" });
      return res.status < 500; // 4xx 也算活着（有响应）
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

function probeTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs() });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export const appLauncherConnector: WidgetConnector = {
  type: "app-launcher",
  async fetch(query: WidgetDataQuery) {
    const rawItems = Array.isArray(query.config.items) ? (query.config.items as ProbeItem[]) : [];
    const results = await Promise.all(
      rawItems.map(async (it) => {
        const probe = it.probe ?? (it.url.startsWith("http") ? "http" : "tcp");
        let alive = false;
        if (probe === "tcp") {
          try {
            // tcp://host:port 或裸 host:port
            const stripped = it.url.replace(/^tcp:\/\//, "");
            const [hostRaw, portRaw] = stripped.split(":");
            const host = hostRaw ?? "";
            const port = Number(portRaw ?? 0);
            if (host && port > 0) {
              // host 可能是域名——允许（内网 DNS）
              const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
              alive = addrs.length > 0 ? await probeTcp(addrs[0].address, port) : false;
            }
          } catch {
            alive = false;
          }
        } else {
          alive = await probeHttp(it.url);
        }
        return { name: it.name ?? it.url, url: it.url, alive };
      }),
    );
    return {
      items: results,
      up: results.filter((r) => r.alive).length,
      total: results.length,
    };
  },
};
