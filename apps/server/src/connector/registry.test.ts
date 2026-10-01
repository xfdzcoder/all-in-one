import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cacheKeyOf, outboundRequest } from "./registry.ts";

describe("cacheKeyOf（SRV-03/SEC-5：嵌套键不得丢失）", () => {
  it("distinguishes configs that differ only in nested fields", () => {
    const a = cacheKeyOf({
      type: "custom-api",
      config: { url: "https://x/api", secret: { type: "secretRef", credentialId: "cred-A" } },
    });
    const b = cacheKeyOf({
      type: "custom-api",
      config: { url: "https://x/api", secret: { type: "secretRef", credentialId: "cred-B" } },
    });
    expect(a).not.toBe(b);
  });

  it("distinguishes nested array items (e.g. launcher items)", () => {
    const a = cacheKeyOf({ type: "app-launcher", config: { items: [{ name: "A", url: "https://a" }] } });
    const b = cacheKeyOf({ type: "app-launcher", config: { items: [{ name: "B", url: "https://b" }] } });
    expect(a).not.toBe(b);
  });

  it("is stable under top-level key order", () => {
    const a = cacheKeyOf({ type: "t", config: { x: 1, y: { z: 2 } } });
    const b = cacheKeyOf({ type: "t", config: { y: { z: 2 }, x: 1 } });
    expect(a).toBe(b);
  });

  it("still separates types", () => {
    expect(cacheKeyOf({ type: "a", config: {} })).not.toBe(cacheKeyOf({ type: "b", config: {} }));
  });
});

describe("outboundRequest maxBytes（SEC-2/SRV-04：边读边判）", () => {
  let server: ReturnType<typeof createServer>;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/big") {
        res.setHeader("Content-Type", "text/plain");
        // 10 × 100KB，逐块推流 —— 旧实现会整包缓冲后才判
        const chunk = Buffer.alloc(100 * 1024, 0x61);
        for (let i = 0; i < 10; i += 1) res.write(chunk);
        res.end();
        return;
      }
      res.end("small");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it("rejects oversized responses (and stops reading)", async () => {
    await expect(
      outboundRequest(`${base}/big`, { maxBytes: 200 * 1024, allowPrivate: true, timeoutMs: 5000 }),
    ).rejects.toThrow(/response too large/);
  });

  it("passes small responses through", async () => {
    const r = await outboundRequest(`${base}/small`, { maxBytes: 1024, allowPrivate: true, timeoutMs: 5000 });
    expect(r.status).toBe(200);
    expect(r.text).toBe("small");
  });
});
