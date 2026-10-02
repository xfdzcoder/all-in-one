import { describe, expect, it } from "vitest";

import { dispatchWs, subscribeWs } from "./ws-stream.ts";

/** Q78/D56：WS 流分发注册表（纯 Map，无 DOM）。 */

describe("ws-stream 分发（Q78）", () => {
  it("按 sourceId 分发；退订后不再收；单订阅者异常不影响其它", () => {
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    const offA = subscribeWs("s1", (p) => gotA.push(p));
    const offB = subscribeWs("s1", () => {
      throw new Error("boom");
    });
    subscribeWs("s2", (p) => gotB.push(p));
    dispatchWs("s1", { v: 1 });
    dispatchWs("s2", { v: 2 });
    expect(gotA).toEqual([{ v: 1 }]);
    expect(gotB).toEqual([{ v: 2 }]);
    offA();
    offB();
    dispatchWs("s1", { v: 3 });
    expect(gotA).toHaveLength(1); // 已退订
  });
});
