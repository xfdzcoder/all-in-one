import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { eq } from "drizzle-orm";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";
import { plugin } from "../db/schema.ts";
import { config } from "../config.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;

const baseManifest = (over: Record<string, unknown> = {}) => ({
  type: "hello-plugin",
  name: "Hello 插件",
  defaultSize: { w: 4, h: 3 },
  configSchema: [{ key: "title", label: "标题", type: "text" }],
  capabilities: { data: { source: "http-connector" } },
  plugin: { entry: "widget.js", apiVersion: "1.0.0" },
  ...over,
});

const packageZip = (over: Record<string, unknown> = {}): Uint8Array =>
  zipSync({
    "manifest.json": strToU8(JSON.stringify(baseManifest(over))),
    "widget.js": strToU8("export default () => null;"),
  });

const packageBase64 = (over: Record<string, unknown> = {}): string =>
  Buffer.from(packageZip(over)).toString("base64");

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = Buffer.from(randomBytes(32)).toString("base64");

  dir = mkdtempSync(join(tmpdir(), "ail-plugin-test-"));
  // pluginsRoot 取自 config.dataDir（getter 动态读 DATABASE_URL）—— 指向临时目录，
  // 测试产物随 afterAll rmSync 清理，不落仓库。
  const dbUrl = `file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`;
  process.env.DATABASE_URL = dbUrl;
  ({ client, db } = await createDb(dbUrl));
  await ensureSchema(db);
  await ensureInitialUser(db);
  app = buildApp({ db });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-admin-password-123" },
  });
  sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";
});

afterAll(async () => {
  await app.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("plugins API (FR-W6 install/uninstall)", () => {
  let pluginId = "";
  let pluginDir = "";

  it("requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins" });
    expect(res.statusCode).toBe(401);
  });

  it("installs a valid package and writes files under dataDir/plugins", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins",
      cookies: { sid },
      payload: { packageBase64: packageBase64() },
    });
    expect(res.statusCode).toBe(201);
    const row = res.json();
    pluginId = row.id;
    pluginDir = row.dir;
    expect(row.type).toBe("hello-plugin");
    expect(row.status).toBe("installed");
    expect(existsSync(join(config.dataDir, "plugins", row.dir, "widget.js"))).toBe(true);
    expect(existsSync(join(config.dataDir, "plugins", row.dir, "manifest.json"))).toBe(true);

    // CON-8：GET /api/plugins/:id 为孤儿端点已删 —— oracle 改 DB 直查
    const rows = await db.select().from(plugin).where(eq(plugin.id, pluginId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.manifestJson).toContain("hello-plugin");
  });

  it("rejects duplicate type with 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins",
      cookies: { sid },
      payload: { packageBase64: packageBase64() },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects reserved built-in type and incompatible apiVersion", async () => {
    const reserved = await app.inject({
      method: "POST",
      url: "/api/plugins",
      cookies: { sid },
      payload: { packageBase64: packageBase64({ type: "todo" }) },
    });
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json().error).toContain("reserved");

    const incompatible = await app.inject({
      method: "POST",
      url: "/api/plugins",
      cookies: { sid },
      payload: {
        packageBase64: packageBase64({
          type: "hello-2",
          plugin: { entry: "widget.js", apiVersion: "2.0.0" },
        }),
      },
    });
    expect(incompatible.statusCode).toBe(400);
    expect(incompatible.json().error).toContain("incompatible");
  });

  it("rejects invalid package and unsafe zip entries", async () => {
    const garbage = await app.inject({
      method: "POST",
      url: "/api/plugins",
      cookies: { sid },
      payload: { packageBase64: Buffer.from("not a zip at all").toString("base64") },
    });
    expect(garbage.statusCode).toBe(400);

    const traversal = zipSync({
      "manifest.json": strToU8(JSON.stringify(baseManifest({ type: "evil-plugin" }))),
      "widget.js": strToU8("x"),
      "../escape.js": strToU8("x"),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins",
      cookies: { sid },
      payload: { packageBase64: Buffer.from(traversal).toString("base64") },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("unsafe entry path");
  });

  it("returns entry code and toggles enable/disable (FR-W6)", async () => {
    const entry = await app.inject({
      method: "GET",
      url: `/api/plugins/${pluginId}/entry`,
      cookies: { sid },
    });
    expect(entry.statusCode).toBe(200);
    expect(entry.json().code).toContain("export default");
    expect(entry.json().manifest.plugin.entry).toBe("widget.js");

    const enabled = await app.inject({
      method: "POST",
      url: `/api/plugins/${pluginId}/enable`,
      cookies: { sid },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().status).toBe("enabled");

    const disabled = await app.inject({
      method: "POST",
      url: `/api/plugins/${pluginId}/disable`,
      cookies: { sid },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().status).toBe("disabled");
  });

  it("lists and uninstalls (files + row removed)", async () => {
    const list = await app.inject({ method: "GET", url: "/api/plugins", cookies: { sid } });
    expect(list.json().map((p: { type: string }) => p.type)).toContain("hello-plugin");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/plugins/${pluginId}`,
      cookies: { sid },
    });
    expect(del.statusCode).toBe(200);
    // FR-W6 卸载：安装目录一并删除
    expect(existsSync(join(config.dataDir, "plugins", pluginDir))).toBe(false);

    const gone = await app.inject({
      method: "GET",
      url: `/api/plugins/${pluginId}`,
      cookies: { sid },
    });
    expect(gone.statusCode).toBe(404);
  });
});
