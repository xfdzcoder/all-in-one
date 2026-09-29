import { createServer, type Server } from "node:http";
import { createServer as createTcp, type Server as TcpServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appLauncherConnector } from "./launcher.ts";
import type { FetchContext, WidgetDataQuery } from "./registry.ts";

let httpUp: Server;
let httpPort: number;
let tcpUp: TcpServer;
let tcpPort: number;

beforeAll(async () => {
  httpUp = createServer((_req, res) => res.writeHead(200).end("ok"));
  tcpUp = createTcp();
  await new Promise<void>((r) => httpUp.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => tcpUp.listen(0, "127.0.0.1", r));
  const h = httpUp.address();
  const t = tcpUp.address();
  httpPort = typeof h === "object" && h ? h.port : 0;
  tcpPort = typeof t === "object" && t ? t.port : 0;
});

afterAll(() => {
  httpUp.close();
  tcpUp.close();
});

const ctx = {} as FetchContext;

describe("app-launcher connector (HTTP/TCP probe)", () => {
  it("probes HTTP service alive", async () => {
    const q: WidgetDataQuery = {
      type: "app-launcher",
      config: { items: [{ name: "面板", url: `http://127.0.0.1:${httpPort}/`, probe: "http" }] },
    };
    const r = (await appLauncherConnector.fetch(q, ctx)) as { items: Array<{ alive: boolean }>; up: number };
    expect(r.items[0].alive).toBe(true);
    expect(r.up).toBe(1);
  });

  it("probes TCP port alive", async () => {
    const q: WidgetDataQuery = {
      type: "app-launcher",
      config: { items: [{ name: "DB", url: `tcp://127.0.0.1:${tcpPort}`, probe: "tcp" }] },
    };
    const r = (await appLauncherConnector.fetch(q, ctx)) as { items: Array<{ alive: boolean }> };
    expect(r.items[0].alive).toBe(true);
  });

  it("marks dead services down (closed port)", async () => {
    const q: WidgetDataQuery = {
      type: "app-launcher",
      config: {
        items: [
          { name: "ok", url: `http://127.0.0.1:${httpPort}/`, probe: "http" },
          { name: "dead", url: "tcp://127.0.0.1:1", probe: "tcp" },
        ],
      },
    };
    const r = (await appLauncherConnector.fetch(q, ctx)) as {
      items: Array<{ name: string; alive: boolean }>;
      up: number;
      total: number;
    };
    expect(r.up).toBe(1);
    expect(r.total).toBe(2);
    expect(r.items.find((i) => i.name === "dead")?.alive).toBe(false);
  });

  it("treats 4xx HTTP response as alive (service answers)", async () => {
    const notFound = createServer((_req, res) => res.writeHead(404).end()).listen(0, "127.0.0.1");
    await new Promise<void>((r) => notFound.once("listening", r));
    const addr = notFound.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const q: WidgetDataQuery = {
      type: "app-launcher",
      config: { items: [{ name: "nf", url: `http://127.0.0.1:${port}/x`, probe: "http" }] },
    };
    const r = (await appLauncherConnector.fetch(q, ctx)) as { items: Array<{ alive: boolean }> };
    expect(r.items[0].alive).toBe(true);
    notFound.close();
  });
});
