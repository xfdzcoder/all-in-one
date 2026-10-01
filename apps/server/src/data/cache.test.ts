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
