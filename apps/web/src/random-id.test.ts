import { afterEach, describe, expect, it } from "vitest";

import { randomId, randomNonce } from "./random-id";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId（Q80：HTTP/HTTPS 行为一致）", () => {
  const original = globalThis.crypto?.randomUUID;
  afterEach(() => {
    if (globalThis.crypto) {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  it("安全上下文：返回 RFC 4122 v4", () => {
    expect(randomId()).toMatch(V4);
  });

  it("非安全上下文（randomUUID undefined）：降级路径同样 v4 且互不重复", () => {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    for (const id of ids) expect(id).toMatch(V4);
    expect(ids.size).toBe(200); // Q80 回归：HTTP 下也能生成组件 id
  });

  it("randomNonce：32 位十六进制（CSP nonce 用）", () => {
    expect(randomNonce()).toMatch(/^[0-9a-f]{32}$/);
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    expect(randomNonce()).toMatch(/^[0-9a-f]{32}$/);
  });
});
