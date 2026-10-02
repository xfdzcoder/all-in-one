import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { httpConnector } from "./http.ts";
import type { FetchContext, WidgetDataQuery } from "./registry.ts";

/** TST-3：custom-api connector 此前只被旅程脚本间接经过 —— 针对性用例补齐。 */

let upstream: Server;
let upstreamUrl: string;
let seen: { auth: string | null; custom: string | null; x: string | null; method: string; body: string } = {
  auth: null, custom: null, x: null, method: "", body: "",
};
let mode: "json" | "text" | "error" = "json";

const ctx = {
  readSecret: async (id: string) => (id === "cred-1" ? "s3cret" : null),
} as unknown as FetchContext;

const query = (config: Record<string, unknown>): WidgetDataQuery => ({ type: "custom-api", config });

beforeAll(async () => {
  // SEC4：custom-api 走 SSRF 基线（默认拒内网）—— mock 服务器在 127.0.0.1，测试期经环境开关放行
  process.env.ALLOW_PRIVATE_OUTBOUND = "1";
  upstream = createServer((req, res) => {
    seen = {
      auth: req.headers.authorization ?? null,
      custom: (req.headers["x-custom"] as string | undefined) ?? null,
      x: (req.headers["x-a"] as string | undefined) ?? null,
      method: req.method ?? "",
      body: "",
    };
    req.on("data", (c) => (seen.body += String(c)));
    req.on("end", () => {
      if (mode === "error") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"error":"boom"}');
      } else if (mode === "text") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("plain text");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"hello":"world"}');
      }
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const addr = upstream.address();
  upstreamUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise((r) => upstream.close(r));
  delete process.env.ALLOW_PRIVATE_OUTBOUND;
});

describe("custom-api connector（TST-3 针对性用例）", () => {
  it("缺 url 显式报错", async () => {
    await expect(httpConnector.fetch(query({}), ctx)).rejects.toThrow("url is required");
  });

  it("默认注入 Authorization: Bearer（凭证引用解析，SEC3）", async () => {
    mode = "json";
    const out = await httpConnector.fetch(query({ url: upstreamUrl, apiToken: { credentialRef: "cred-1" } }), ctx);
    expect(out).toEqual({ hello: "world" });
    expect(seen.auth).toBe("Bearer s3cret");
  });

  it("authHeader 自定义头名则原样放值（不加 Bearer 前缀）", async () => {
    await httpConnector.fetch(query({ url: upstreamUrl, apiToken: "tok", authHeader: "X-Custom" }), ctx);
    expect(seen.auth).toBeNull();
    expect(seen.custom).toBe("tok");
  });

  it("静态头逐行解析（Name: value）", async () => {
    await httpConnector.fetch(query({ url: upstreamUrl, headers: "X-A: 1\nbad-line\nX-A2: 2" }), ctx);
    expect(seen.x).toBe("1");
  });

  it("method=POST 时透传 body", async () => {
    await httpConnector.fetch(query({ url: upstreamUrl, method: "POST", body: '{"a":1}' }), ctx);
    expect(seen.method).toBe("POST");
    expect(seen.body).toBe('{"a":1}');
  });

  it("上游 4xx/5xx 显式报错（不吞）", async () => {
    mode = "error";
    await expect(httpConnector.fetch(query({ url: upstreamUrl }), ctx)).rejects.toThrow("upstream HTTP 500");
    mode = "json";
  });

  it("非 JSON 响应回落 { raw }（不伪装成解析结果）", async () => {
    mode = "text";
    expect(await httpConnector.fetch(query({ url: upstreamUrl }), ctx)).toEqual({ raw: "plain text" });
    mode = "json";
  });
});
