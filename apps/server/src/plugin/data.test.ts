import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
import { config } from "../config.ts";
import { createCredential } from "../credentials/store.ts";
import { plugin, user } from "../db/schema.ts";
import { installPlugin, setPluginStatus } from "./install.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;
let userId: string;
let credId: string;
let upstream: Server;
let upstreamUrl: string;

const manifest = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  name: `插件 ${type}`,
  defaultSize: { w: 4, h: 3 },
  configSchema: [
    { key: "url", label: "地址", type: "text" },
    { key: "apiToken", label: "令牌", type: "secret" },
  ],
  capabilities: { data: { source: "http-connector" } },
  plugin: {
    entry: "widget.js",
    apiVersion: "1.0.0",
    permissions: { apis: ["widgets.data"], credentialKinds: ["http-header"] },
  },
  ...over,
});

const packageZip = (type: string, over: Record<string, unknown> = {}): Uint8Array =>
  zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest(type, over))),
    "widget.js": strToU8("export default function render() {}"),
  });

const install = async (type: string, over: Record<string, unknown> = {}, enable = true) => {
  const row = await installPlugin(db, userId, packageZip(type, over), {
    pluginsRoot: join(config.dataDir, "plugins"),
  });
  if (enable) await setPluginStatus(db, userId, row.id, "enabled");
  return row;
};

const queryData = (type: string, cfg: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: "/api/widgets/data",
    cookies: { sid },
    payload: { type, config: cfg, force: true },
  });

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = Buffer.from(randomBytes(32)).toString("base64");
  // 本机 mock upstream —— 放行内网出站（同 credentials/routes.test.ts）
  process.env.ALLOW_PRIVATE_OUTBOUND = "1";

  dir = mkdtempSync(join(tmpdir(), "ail-plugin-data-"));
  const dbUrl = `file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`;
  process.env.DATABASE_URL = dbUrl;
  ({ client, db } = await createDb(dbUrl));
  await ensureSchema(db);
  await ensureInitialUser(db);
  userId = (await db.select().from(user).limit(1))[0].id;
  credId = (await createCredential(db, userId, "tok", "http-header", "sk-test-token")).id;

  app = buildApp({ db });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-admin-password-123" },
  });
  sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";

  // mock upstream：回显鉴权头，供凭证注入断言
  upstream = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, auth: req.headers.authorization ?? "" }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const addr = upstream.address();
  upstreamUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
});

afterAll(async () => {
  await app.close();
  upstream.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("plugin data bridge + permission allowlists (FR-W3/FR-W7, D26)", () => {
  it("routes plugin data through the host channel (http-connector)", async () => {
    await install("plug-a");
    const res = await queryData("plug-a", { url: upstreamUrl });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ok).toBe(true);
    expect(res.json().data.auth).toBe("");
  });

  it("rejects data access without widgets.data permission", async () => {
    await install("plug-b", {
      plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions: {} },
    });
    const res = await queryData("plug-b", { url: upstreamUrl });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("widgets.data");
  });

  it("rejects credential kinds not declared (credentialKinds)", async () => {
    await install("plug-c", {
      plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions: { apis: ["widgets.data"] } },
    });
    const res = await queryData("plug-c", { url: upstreamUrl, apiToken: { credentialRef: credId } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("credential kind");
  });

  it("injects declared credential kinds (secret resolved server-side only)", async () => {
    const res = await queryData("plug-a", { url: upstreamUrl, apiToken: { credentialRef: credId } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.auth).toBe("Bearer sk-test-token");
  });

  it("rejects plugins declaring no data source", async () => {
    await install("plug-d", {
      capabilities: { data: { source: "none" } },
    });
    const res = await queryData("plug-d", {});
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("no data source");
  });

  it("disabled plugins behave like unknown types", async () => {
    const rows = await db.select().from(plugin);
    const a = rows.find((r) => r.type === "plug-a");
    await setPluginStatus(db, userId, a!.id, "disabled");
    const res = await queryData("plug-a", { url: upstreamUrl });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("unknown widget type");
  });
});
