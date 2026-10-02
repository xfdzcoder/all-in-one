import type { WidgetConnector } from "./registry.ts";
import { assertSafeOutboundUrl } from "./ssrf.ts";

/**
 * iframe 禁嵌检测 connector（FR：目标站禁嵌时明确提示 / SEC5）。
 *
 * 浏览器在 X-Frame-Options、CSP frame-ancestors 拒绝嵌入时**仍会触发 iframe 的
 * load 事件**（Chrome 在 frame 内载入错误页，实测确认）——前端无法据此识别禁嵌，
 * 因此由服务端读取响应头判定，与真实嵌入决策同源。
 *
 * 目标多为内网面板（Portainer/NAS 等，J7 主场景）→ 走 allowPrivate 通道（D22，
 * 同 app-launcher）；**逐跳**重做 SSRF 校验且不自动跟随跳转。不可达 / 重定向超限时
 * 不误报（verified:false，前端按可嵌入正常渲染）。
 */

interface EmbedCheck {
  /** false = 目标站禁止被嵌入。 */
  embeddable: boolean;
  /** 判定依据（禁嵌原因 / 说明）。 */
  reason: string;
  /** false = 未能验证（网络不可达或重定向超限），前端按可嵌入处理。 */
  verified: boolean;
}

const MAX_HOPS = 3;
const TIMEOUT_MS = 5000;

/** 按 X-Frame-Options / CSP frame-ancestors 判定目标页可否被 parentOrigin 嵌入。 */
export function judgeEmbeddable(
  headers: Headers,
  targetUrl: string,
  parentOrigin: string | null,
): { embeddable: boolean; reason: string } {
  const targetOrigin = new URL(targetUrl).origin;

  const xfo = headers.get("x-frame-options")?.trim().toLowerCase() ?? "";
  if (xfo) {
    const [policy, ...rest] = xfo.split(/\s+/);
    if (policy === "deny") return { embeddable: false, reason: "X-Frame-Options: deny" };
    if (policy === "sameorigin" && parentOrigin !== targetOrigin) {
      return { embeddable: false, reason: "X-Frame-Options: sameorigin" };
    }
    if (policy === "allow-from") {
      const allowed = rest.join(" ").split(",").map((s) => s.trim()).filter(Boolean);
      if (!parentOrigin || !allowed.includes(parentOrigin)) {
        return { embeddable: false, reason: "X-Frame-Options: allow-from" };
      }
    }
  }

  const parentHost = parentOrigin ? new URL(parentOrigin).hostname : null;
  for (const directive of (headers.get("content-security-policy") ?? "").split(";")) {
    const tokens = directive.trim().split(/\s+/).filter(Boolean);
    if (tokens[0]?.toLowerCase() !== "frame-ancestors") continue;
    const sources = tokens.slice(1).map((t) => t.toLowerCase());
    if (sources.includes("*")) break;
    if (sources.includes("'none'")) return { embeddable: false, reason: "CSP frame-ancestors 'none'" };
    const matched = parentOrigin
      ? sources.some((s) => {
          if (s === "'self'") return parentOrigin === targetOrigin;
          const host = s.replace(/^[a-z]+:\/\//, "").replace(/:\d+$/, "").replace(/^\*\./, "");
          return parentHost === host || (parentHost?.endsWith(`.${host}`) ?? false);
        })
      : false;
    if (!matched) return { embeddable: false, reason: "CSP frame-ancestors mismatch" };
    break;
  }

  return { embeddable: true, reason: "no blocking headers" };
}

export const iframeEmbedConnector: WidgetConnector = {
  type: "iframe-embed",
  async fetch(query): Promise<EmbedCheck> {
    const rawUrl = typeof query.config.url === "string" ? query.config.url : "";
    const parentOrigin =
      typeof query.config.parentOrigin === "string" && query.config.parentOrigin
        ? query.config.parentOrigin
        : null;
    if (!rawUrl) return { embeddable: true, reason: "empty url", verified: false };

    try {
      let current = rawUrl;
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        const { url: u } = await assertSafeOutboundUrl(current, true); // D22: 内网面板是核心场景
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(u, { method: "GET", signal: controller.signal, redirect: "manual" });
          const location = res.headers.get("location");
          if (res.status >= 300 && res.status < 400 && location) {
            if (res.body) void res.body.cancel().catch(() => {});
            current = new URL(location, u).toString(); // 下一跳重新过 SSRF 校验
            continue;
          }
          const verdict = judgeEmbeddable(res.headers, current, parentOrigin);
          if (res.body) void res.body.cancel().catch(() => {});
          return { ...verdict, verified: true };
        } finally {
          clearTimeout(timer);
        }
      }
      return { embeddable: true, reason: "too many redirects", verified: false };
    } catch {
      return { embeddable: true, reason: "unreachable: cannot verify", verified: false };
    }
  },
};
