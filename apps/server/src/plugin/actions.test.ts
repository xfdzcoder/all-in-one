import { randomBytes } from "node:crypto";
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
import { plugin, todo, user } from "../db/schema.ts";
import { installPlugin, setPluginStatus } from "./install.ts";
import { eq } from "drizzle-orm";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;
let userId: string;
let pluginId: string;

const manifest = (type: string, actions: string[]) => ({
  type,
  name: `插件 ${type}`,
  defaultSize: { w: 4, h: 3 },
  configSchema: [{ key: "title", label: "标题", type: "text" }],
  capabilities: { data: { source: "none" } },
  plugin: {
    entry: "widget.js",
    apiVersion: "1.0.0",
    permissions: { actions },
  },
});

const packageZip = (type: string, actions: string[]): Uint8Array =>
  zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest(type, actions))),
    "widget.js": strToU8("export default function render() {}"),
  });

const act = (id: string, name: string, params: unknown) =>
  app.inject({
    method: "POST",
    url: `/api/plugins/${id}/actions`,
    cookies: { sid },
    payload: { name, params },
  });

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.CREDENTIALS_MASTER_KEY = Buffer.from(randomBytes(32)).toString("base64");

  dir = mkdtempSync(join(tmpdir(), "ail-plugin-actions-"));
  const dbUrl = `file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`;
  process.env.DATABASE_URL = dbUrl;
  ({ client, db } = await createDb(dbUrl));
  await ensureSchema(db);
  await ensureInitialUser(db);
  userId = (await db.select().from(user).limit(1))[0].id;

  app = buildApp({ db });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-admin-password-123" },
  });
  sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";

  const row = await installPlugin(db, userId, packageZip("act-p", ["todo.create", "todo.toggle", "feed.markRead", "nope.run"]), {
    pluginsRoot: join(config.dataDir, "plugins"),
  });
  await setPluginStatus(db, userId, row.id, "enabled");
  pluginId = row.id;
});

afterAll(async () => {
  await app.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("plugin action channel (FR-I5/FR-W7, D27)", () => {
  it("executes allowlisted todo.create and todo.toggle server-side", async () => {
    const created = await act(pluginId, "todo.create", { title: "来自插件的任务", list: "work" });
    expect(created.statusCode).toBe(200);
    const id = created.json().result.id;
    const rows = await db.select().from(todo).where(eq(todo.id, id));
    expect(rows[0]).toBeTruthy();
    expect(rows[0].title).toBe("来自插件的任务");
    expect(rows[0].list).toBe("work");

    const toggled = await act(pluginId, "todo.toggle", { id });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json().result.done).toBe(true);
  });

  it("feed.markRead is idempotent", async () => {
    const first = await act(pluginId, "feed.markRead", { itemKey: "item-1" });
    const second = await act(pluginId, "feed.markRead", { itemKey: "item-1" });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it("rejects actions not declared in permissions.actions", async () => {
    const res = await act(pluginId, "todo.delete", { id: "x" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("not declared");
  });

  it("rejects declared-but-unknown actions and invalid params", async () => {
    const unknown = await act(pluginId, "nope.run", {});
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toContain("unknown action");

    const badParams = await act(pluginId, "todo.create", { title: "" });
    expect(badParams.statusCode).toBe(400);
    expect(badParams.json().error).toContain("invalid params");
  });

  it("rejects actions from disabled plugins", async () => {
    await setPluginStatus(db, userId, pluginId, "disabled");
    const res = await act(pluginId, "todo.create", { title: "x" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("disabled");
    const rows = await db.select().from(plugin).where(eq(plugin.id, pluginId));
    expect(rows[0].status).toBe("disabled");
  });
});
