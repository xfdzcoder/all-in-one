import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SEC4 SSRF 基线：出站 HTTP connector 默认拒绝内网目标。
 * 校验顺序：URL 解析 → 协议白名单 → host IP/CNAME 解析 → 内网段判定。
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** RFC1918 / 回环 / 链路本地 / 组播 / 保留段 —— 默认拒绝。 */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 0 || a >= 224) return true; // reserved / multicast
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped — re-check as IPv4
      return isPrivateIp(lower.slice(7));
    }
    return false;
  }
  return true; // 不是合法 IP 一律拒绝
}

export class SsrfBlockedError extends Error {
  constructor(target: string, reason: string) {
    super(`SSRF blocked for ${target}: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

/** DNS 解析器抽象（可注入以便测试；默认 node:dns）。 */
export type HostResolver = (host: string) => Promise<Array<{ address: string }>>;

/**
 * 校验出站 URL 可否访问。hostnames 先解析 DNS（防 DNS rebinding：拒绝解析到内网的域名）。
 * @param rawUrl 待请求的完整 URL
 * @param allowPrivate 显式放行内网（仅测试 / 未来用户白名单用；默认 false）
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  allowPrivate = false,
  resolve: HostResolver = (host) => lookup(host, { all: true }),
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, "malformed URL");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(rawUrl, `protocol ${url.protocol} not allowed`);
  }
  if (allowPrivate) return url;

  const host = url.hostname;
  if (!host) throw new SsrfBlockedError(rawUrl, "missing host");

  // IP 字面量直接判定；域名走 DNS 解析后逐个判定（含 CNAME 链落地 IP）。
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new SsrfBlockedError(rawUrl, `private IP ${host}`);
    return url;
  }
  if (host === "localhost") {
    throw new SsrfBlockedError(rawUrl, "localhost not allowed");
  }

  let addrs: Array<{ address: string }>;
  try {
    addrs = await resolve(host);
  } catch {
    throw new SsrfBlockedError(rawUrl, "DNS resolution failed");
  }
  if (addrs.length === 0) throw new SsrfBlockedError(rawUrl, "no DNS records");
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(rawUrl, `resolves to private IP ${address}`);
    }
  }
  return url;
}
