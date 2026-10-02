import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cacheKeyOf, mapLimit, outboundRequest } from "./registry.ts";

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

describe("mapLimit（SRV-29：小并发 + 总时间预算）", () => {
  it("并发不超过上限，结果保序", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("预算耗尽后不再打上游（剩余项保持 null）", async () => {
    let calls = 0;
    const out = await mapLimit(
      [1, 2, 3, 4],
      1,
      async (n) => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 30));
        return n;
      },
      { budgetMs: 40 },
    );
    expect(calls).toBeLessThan(4);
    expect(out.some((x) => x === null)).toBe(true);
  });
});

describe("loadSourceConfig（SRV-07：损坏配置说「原因 + 怎么修」）", () => {
  it("合法 JSON 返回对象；空对象合法", async () => {
    const { loadSourceConfig } = await import("./registry.ts");
    expect(loadSourceConfig('{"url":"https://x"}')).toEqual({ url: "https://x" });
    expect(loadSourceConfig("{}")).toEqual({});
  });

  it("损坏 JSON 抛错：含原因 + 怎么修，且带 cause（错误链不断）", async () => {
    const { loadSourceConfig } = await import("./registry.ts");
    let caught: Error | null = null;
    try {
      loadSourceConfig("{oops", "监控源");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toContain("配置已损坏"); // 原因
    expect(caught?.message).toContain("重新填写并保存"); // 怎么修
    expect(caught?.message).toContain("监控源"); // 带上下文
    expect(caught?.cause).toBeTruthy();
  });
});
