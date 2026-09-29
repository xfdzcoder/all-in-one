import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { iframeEmbedConnector, judgeEmbeddable } from "./iframe.ts";
import type { FetchContext, WidgetDataQuery } from "./registry.ts";

const PARENT = "http://192.168.31.100:4173";
const ctx = {} as FetchContext;

const query = (url: string): WidgetDataQuery => ({
  type: "iframe-embed",
  config: { url, parentOrigin: PARENT },
});

const headersOf = (rec: Record<string, string>) => new Headers(rec);

describe("judgeEmbeddable (X-Frame-Options / CSP frame-ancestors)", () => {
  it("passes when no blocking headers", () => {
    const r = judgeEmbeddable(headersOf({}), "http://panel.local/", PARENT);
    expect(r.embeddable).toBe(true);
  });

  it("blocks X-Frame-Options: deny", () => {
    const r = judgeEmbeddable(headersOf({ "x-frame-options": "DENY" }), "http://panel.local/", PARENT);
    expect(r.embeddable).toBe(false);
    expect(r.reason).toContain("deny");
  });

  it("blocks X-Frame-Options: sameorigin from another origin", () => {
    const r = judgeEmbeddable(
      headersOf({ "x-frame-options": "sameorigin" }),
      "http://panel.local:9000/",
      PARENT,
    );
    expect(r.embeddable).toBe(false);
  });

  it("allows X-Frame-Options: sameorigin from the same origin", () => {
    const r = judgeEmbeddable(
      headersOf({ "x-frame-options": "sameorigin" }),
      `${PARENT}/inner`,
      PARENT,
    );
    expect(r.embeddable).toBe(true);
  });

  it("blocks CSP frame-ancestors 'none'", () => {
    const r = judgeEmbeddable(
      headersOf({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }),
      "http://panel.local/",
      PARENT,
    );
    expect(r.embeddable).toBe(false);
  });

  it("blocks CSP frame-ancestors list without the parent host", () => {
    const r = judgeEmbeddable(
      headersOf({ "content-security-policy": "frame-ancestors https://other.example" }),
      "http://panel.local/",
      PARENT,
    );
    expect(r.embeddable).toBe(false);
  });

  it("allows CSP frame-ancestors list containing the parent host", () => {
    const r = judgeEmbeddable(
      headersOf({ "content-security-policy": "frame-ancestors 192.168.31.100:4173 *.other.example" }),
      "http://panel.local/",
      PARENT,
    );
    expect(r.embeddable).toBe(true);
  });

  it("allows CSP frame-ancestors *", () => {
    const r = judgeEmbeddable(
      headersOf({ "content-security-policy": "frame-ancestors *" }),
      "http://panel.local/",
      PARENT,
    );
    expect(r.embeddable).toBe(true);
  });
});

describe("iframe-embed connector", () => {
  let blocked: Server;
  let open: Server;
  let redirect: Server;
  let blockedUrl: string;
  let openUrl: string;
  let redirectUrl: string;

  beforeAll(async () => {
    blocked = createServer((_req, res) =>
      res
        .writeHead(200, {
          "Content-Type": "text/html",
          "X-Frame-Options": "DENY",
          "Content-Security-Policy": "frame-ancestors 'none'",
        })
        .end("<h1>blocked</h1>"),
    );
    open = createServer((_req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end("<h1>ok</h1>"));
    redirect = createServer((_req, res) => {
      res.writeHead(302, { Location: blockedUrl }).end();
    });
    await new Promise<void>((r) => blocked.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => open.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => redirect.listen(0, "127.0.0.1", r));
    const b = blocked.address();
    const o = open.address();
    const rd = redirect.address();
    blockedUrl = `http://127.0.0.1:${typeof b === "object" && b ? b.port : 0}/`;
    openUrl = `http://127.0.0.1:${typeof o === "object" && o ? o.port : 0}/`;
    redirectUrl = `http://127.0.0.1:${typeof rd === "object" && rd ? rd.port : 0}/`;
  });

  afterAll(() => {
    blocked.close();
    open.close();
    redirect.close();
  });

  it("reports embeddable for open page", async () => {
    const r = (await iframeEmbedConnector.fetch(query(openUrl), ctx)) as { embeddable: boolean; verified: boolean };
    expect(r.verified).toBe(true);
    expect(r.embeddable).toBe(true);
  });

  it("reports blocked for XFO/frame-ancestors page", async () => {
    const r = (await iframeEmbedConnector.fetch(query(blockedUrl), ctx)) as {
      embeddable: boolean;
      verified: boolean;
      reason: string;
    };
    expect(r.verified).toBe(true);
    expect(r.embeddable).toBe(false);
  });

  it("follows redirect hop (per-hop SSRF check) and judges final headers", async () => {
    const r = (await iframeEmbedConnector.fetch(query(redirectUrl), ctx)) as { embeddable: boolean; verified: boolean };
    expect(r.verified).toBe(true);
    expect(r.embeddable).toBe(false);
  });

  it("unreachable target does not false-positive (verified: false)", async () => {
    const r = (await iframeEmbedConnector.fetch(query("http://127.0.0.1:1/"), ctx)) as {
      embeddable: boolean;
      verified: boolean;
    };
    expect(r.verified).toBe(false);
    expect(r.embeddable).toBe(true);
  });

  it("empty url → verified: false", async () => {
    const r = (await iframeEmbedConnector.fetch(query(""), ctx)) as { verified: boolean };
    expect(r.verified).toBe(false);
  });
});
