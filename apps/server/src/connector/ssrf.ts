import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SEC4 SSRF 基线：出站 HTTP connector 默认拒绝内网目标。
 * 校验顺序：URL 解析 → 协议白名单 → host IP/CNAME 解析 → 内网段判定。
 */

// D56/Q77：WS 数据源出站同走 SSRF 基线（ws/wss 与 http/https 同源判定、同 IP 钉死）
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

/** RFC1918 / 回环 / 链路本地 / 组播 / 保留段 —— 默认拒绝。 */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  // `isIP` 不认 IPv6 嵌入 IPv4 的部分写法（如 `::ffff:8.8.8.8`），组解析兜住
  if (v === 6 || ipv6Groups(ip)) return isPrivateV6(ip);
  return true; // 不是合法 IP 一律拒绝
}

/** IPv4：内网/保留段判定（SEC-1 补齐 CGNAT、TEST-NET、benchmark 等段）。 */
function isPrivateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local（云元数据）
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24（IETF）
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** 把 IPv6 展开成 8 个 16 位组（尾部嵌入的 IPv4 先拆成两组）；解析不了返回 null。 */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const v4m = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4m) {
    const nums = v4m[2].split(".").map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n > 255)) return null;
    const hi = ((nums[0] << 8) | nums[1]).toString(16);
    const lo = ((nums[2] << 8) | nums[3]).toString(16);
    s = `${v4m[1]}${hi}:${lo}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length !== 2 && head.length !== 8)) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  const groups = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? Number.parseInt(p, 16) : NaN));
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** IPv6：组级判定（比字符串前缀严格 —— `fe81::`、`ff02::1`、十六进制 IPv4-mapped 都不再漏）。 */
function isPrivateV6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true; // 解析不了按内网处理（fail-closed）
  // IPv4-mapped（::ffff:x.x.x.x / ::ffff:7f00:1）与 IPv4-compatible（::x.x.x.x）
  // —— **必须按内嵌 IPv4 复检**（SRV-01：十六进制形态曾整体漏判放行 127.0.0.1）
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join("."));
  }
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local（fe80–febf 全段）
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 文档段
  return false;
}

/** SEC-4：错误/日志里的 URL **脱敏** —— 去 userinfo（user:pass@）、query 值打码（保留键名）。
 *  custom-api 等配置的 URL 常带 `?apikey=…` 或基本认证，明文进 502 响应体/日志 = 密钥外发。 */
export function sanitizeUrlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    const keys = [...u.searchParams.keys()];
    for (const k of keys) u.searchParams.set(k, "****");
    return u.toString().replace(/\?$/, "");
  } catch {
    return "<invalid-url>";
  }
}

export class SsrfBlockedError extends Error {
  constructor(target: string, reason: string) {
    super(`SSRF blocked for ${sanitizeUrlForLog(target)}: ${reason}`);
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
): Promise<{ url: URL; pinnedIp: string | null }> {
  // SEC-3：返回**已验证的落地 IP** —— 调用方按它建连（DNS rebinding 的 TOCTOU 窗口：
  // 校验时解析一次、fetch 再解析一次，两次之间可翻转到内网；IP 钉死后「校验结果 = 连接目标」）。
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, "malformed URL");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(rawUrl, `protocol ${url.protocol} not allowed`);
  }
  if (allowPrivate) {
    // 放行模式（测试/白名单）也尽量钉 IP；解析失败退回系统解析（pinnedIp=null）
    const h = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (isIP(h) || ipv6Groups(h)) return { url, pinnedIp: h };
    try {
      const addrs = await resolve(h);
      return { url, pinnedIp: addrs[0]?.address ?? null };
    } catch {
      return { url, pinnedIp: null };
    }
  }

  // WHATWG URL 的 hostname 对 IPv6 带方括号（`[::ffff:808:808]`）——先剥掉再判字面量，
  // 否则 `isIP` 判 0、被当域名走 DNS（[::1] 等此前是「碰巧被 DNS 失败拦住」）。
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!host) throw new SsrfBlockedError(rawUrl, "missing host");

  // IP 字面量直接判定；域名走 DNS 解析后逐个判定（含 CNAME 链落地 IP）。
  // 注意：IPv6 嵌入 IPv4 的多种写法（`::ffff:8.8.8.8` 等）`isIP` 不认，统一按组解析当字面量，
  // 否则会错走 DNS 路径被误拦（fail-closed 但语义不对）。
  if (isIP(host) || ipv6Groups(host)) {
    if (isPrivateIp(host)) throw new SsrfBlockedError(rawUrl, `private IP ${host}`);
    return { url, pinnedIp: host };
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
  return { url, pinnedIp: addrs[0]!.address }; // 全部地址已验安全；钉第一个（SEC-3）
}
