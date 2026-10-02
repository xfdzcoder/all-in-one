import type { WidgetConnector, WidgetDataQuery, FetchContext } from "./registry.ts";
import { outboundRequest, resolveSecretRefs } from "./registry.ts";

/**
 * 自定义 API connector（D14 数据侧）：
 * widget 配置 → 服务端代取（SSRF 基线 + 凭证注入）→ 原始 JSON 交给模板渲染。
 */
export const httpConnector: WidgetConnector = {
  type: "custom-api",
  async fetch(query: WidgetDataQuery, ctx: FetchContext) {
    const config = await resolveSecretRefs(query.config, ctx);
    const url = String(config.url ?? "");
    if (!url) throw new Error("url is required");
    // D65（用户反馈⑤）：相对地址应由前端按「认证来源」站点地址拼接；拼不到（未选来源/
    // 来源缺地址）到这一步要**明确报「原因 + 怎么修」**，不把畸形 URL 的天书抛给用户
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      throw new Error(
        `接口地址是相对路径（${url}）—— 请选「认证来源」（相对地址按它的站点地址拼接），或直接填完整 https:// 地址`,
      );
    }

    const headers: Record<string, string> = {};
    // 可选凭证注入：默认 Authorization: Bearer <token>；authHeader 自定义头名则原样放值
    const token = typeof config.apiToken === "string" ? config.apiToken : "";
    const authHeader = typeof config.authHeader === "string" ? config.authHeader.trim() : "";
    if (token) {
      if (authHeader) headers[authHeader] = token;
      else headers.Authorization = `Bearer ${token}`;
    }
    // 附加静态头（"Name: value" 每行一条）
    if (typeof config.headers === "string" && config.headers) {
      for (const line of config.headers.split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }

    const method = config.method === "POST" ? "POST" : "GET";
    const res = await outboundRequest(url, {
      method,
      headers,
      body: method === "POST" && typeof config.body === "string" ? config.body : undefined,
    });
    if (res.status >= 400) throw new Error(`upstream HTTP ${res.status}`);

    try {
      return JSON.parse(res.text);
    } catch {
      return { raw: res.text };
    }
  },
};
