import { describe, expect, it, vi } from "vitest";

import { cacheKeyOf, createConnectorRegistry, UnknownWidgetTypeError } from "../connector/registry.ts";
import { DataCache } from "./cache.ts";
import { EventBus } from "./events.ts";

describe("data cache (NFR4)", () => {
  it("serves within TTL and expires after", () => {
    // TST-7：假时钟推进 —— 原真实 sleep 1.1s 且与 TTL 实现值耦合（调参即假红/假绿）
    vi.useFakeTimers();
    try {
      const cache = new DataCache({ defaultTtlSec: 1, minIntervalSec: 0 });
      cache.set("k", { v: 1 });
      expect(cache.get("k")?.data).toEqual({ v: 1 });
      vi.advanceTimersByTime(1100);
      expect(cache.get("k")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rate-limits fetches under minInterval", () => {
    const cache = new DataCache({ minIntervalSec: 60 });
    expect(cache.allowFetch("k")).toBe(true);
    cache.set("k", "data");
    expect(cache.allowFetch("k")).toBe(false); // 刚取过
  });

  it("invalidates entries", () => {
    const cache = new DataCache();
    cache.set("k", "v");
    cache.invalidate("k");
    expect(cache.get("k")).toBeNull();
    expect(cache.allowFetch("k")).toBe(true);
  });
});

describe("cache key stability", () => {
  it("is stable regardless of config key order", () => {
    const a = cacheKeyOf({ type: "http", config: { url: "x", method: "GET" } });
    const b = cacheKeyOf({ type: "http", config: { method: "GET", url: "x" } });
    expect(a).toBe(b);
    const c = cacheKeyOf({ type: "http", config: { url: "y", method: "GET" } });
    expect(c).not.toBe(a);
  });
});

describe("connector registry", () => {
  it("registers and resolves by type; unknown type throws", () => {
    const reg = createConnectorRegistry();
    reg.register({ type: "demo", fetch: async () => 42 });
    expect(reg.has("demo")).toBe(true);
    expect(() => reg.get("nope")).toThrow(UnknownWidgetTypeError);
  });
});

describe("event bus (FR-I6)", () => {
  it("publishes to subscribers and unsubscribes cleanly", () => {
    const bus = new EventBus();
    const got: string[] = [];
    const off = bus.subscribe((e) => got.push(e.topic));
    bus.publish("todo");
    off();
    bus.publish("todo");
    expect(got).toEqual(["todo"]);
  });
});
