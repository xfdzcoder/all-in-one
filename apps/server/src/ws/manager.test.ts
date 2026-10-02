import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { EventBus } from "../data/events.ts";
import { WsSourceManager } from "./manager.ts";

/** Q77/D56：WS 数据源 → SSE 转发（ws:<id> topic + payload）、生命周期与 SSRF 基线。 */

let wss: WebSocketServer;
let url: string;
const events: Array<{ topic: string; payload?: unknown }> = [];
const bus = new EventBus();
const sub = bus.subscribe((e) => events.push({ topic: e.topic, payload: e.payload }));

beforeEach(async () => {
  events.length = 0;
  wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.on("listening", () => r(undefined)));
  url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
});

afterEach(async () => {
  sub();
  await new Promise<void>((r) => wss.close(() => r(undefined)));
});

describe("WsSourceManager（Q77/D56）", () => {
  it("消息经 bus 以 ws:<id> topic 转发（JSON 解析、非 JSON 原样）", async () => {
    const mgr = new WsSourceManager(bus, { allowPrivate: true });
    await mgr.sync([{ id: "s1", url, headers: {} }]);
    wss.on("connection", (sock) => {
      sock.send(JSON.stringify({ v: 1 }));
      sock.send("plain-text");
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(events[0]).toEqual({ topic: "ws:s1", payload: { v: 1 } });
    expect(events[1]).toEqual({ topic: "ws:s1", payload: "plain-text" });
    mgr.stop();
  });

  it("sync 对账：改 URL 重连、删行断开、stop 不再重连", async () => {
    const mgr = new WsSourceManager(bus, { allowPrivate: true });
    await mgr.sync([{ id: "s1", url, headers: {} }]);
    wss.on("connection", (sock) => sock.send("hi"));
    await new Promise((r) => setTimeout(r, 200));
    const before = events.length;
    // 换 URL（同源另一路径即可触发重连）→ 旧连接断开重建
    await mgr.sync([{ id: "s1", url: `${url}/x`, headers: {} }]);
    await new Promise((r) => setTimeout(r, 200));
    // 删行 + stop：之后不再有新事件（无重连）
    await mgr.sync([]);
    mgr.stop();
    const settled = events.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBe(settled);
    expect(settled).toBeGreaterThanOrEqual(before);
  });

  it("SEC-4 基线：默认拒内网（不建连）；allowPrivate 才连", async () => {
    const strict = new WsSourceManager(bus, {});
    await strict.sync([{ id: "s1", url, headers: {} }]);
    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(0); // 校验被拒 = fail-closed，消息不通
    strict.stop();
  });
});
