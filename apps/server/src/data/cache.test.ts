import { describe, expect, it } from "vitest";

import { DataCache } from "./cache.ts";

describe("DataCache.coalesce（SRV-06：single-flight）", () => {
  it("merges concurrent same-key fetches into one upstream call", async () => {
    const cache = new DataCache();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { v: calls };
    };
    const [a, b, c] = await Promise.all([
      cache.coalesce("k", fn),
      cache.coalesce("k", fn),
      cache.coalesce("k", fn),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("does not merge different keys", async () => {
    const cache = new DataCache();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return calls;
    };
    await Promise.all([cache.coalesce("a", fn), cache.coalesce("b", fn)]);
    expect(calls).toBe(2);
  });

  it("releases the slot after settle (next call re-fetches) and propagates errors", async () => {
    const cache = new DataCache();
    let calls = 0;
    const failing = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("upstream down");
    };
    await expect(cache.coalesce("k", failing)).rejects.toThrow("upstream down");
    await expect(cache.coalesce("k", failing)).rejects.toThrow("upstream down");
    expect(calls).toBe(2); // 不是 1 —— 失败后必须释放，不能把失败结果当共享值
  });
});

describe("DataCache 字节封顶（SRV-05：base64 缩略图常驻内存）", () => {
  it("超字节预算时按 LRU 淘汰旧条目", () => {
    const cache = new DataCache({ maxBytes: 3000 });
    cache.set("a", { blob: "x".repeat(1000) });
    cache.set("b", { blob: "x".repeat(1000) });
    cache.set("c", { blob: "x".repeat(1500) }); // 3500 > 3000 → 淘汰 a
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).not.toBeNull();
    expect(cache.get("c")).not.toBeNull();
  });

  it("覆盖同 key 退还旧字节（不重复计账）", () => {
    const cache = new DataCache({ maxBytes: 3000 });
    cache.set("k", { blob: "x".repeat(2500) });
    cache.set("k", { blob: "y".repeat(100) }); // 覆盖：总占用≈100
    cache.set("z", { blob: "x".repeat(2500) }); // 装得下 ⇒ k 仍在
    expect(cache.get("k")).not.toBeNull();
    expect(cache.get("z")).not.toBeNull();
  });

  it("过期即退还字节", async () => {
    const cache = new DataCache({ maxBytes: 3000 });
    cache.set("t", { blob: "x".repeat(2500) }, 0.001);
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get("t")).toBeNull();
    cache.set("u", { blob: "x".repeat(2500) });
    expect(cache.get("u")).not.toBeNull();
  });
});
