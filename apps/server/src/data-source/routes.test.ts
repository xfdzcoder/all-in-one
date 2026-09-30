import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { buildApp } from "../app.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  dir = mkdtempSync(join(tmpdir(), "ail-ds-test-"));
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
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
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

const json = (res: { json: () => unknown }) => res.json() as Record<string, never>;

describe("data sources API（D42 命名连接）", () => {
  let monId = "";

  it("未登录 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/data-sources" });
    expect(res.statusCode).toBe(401);
  });

  it("创建 monitor 连接：201；同 kind 同名 409；未知 config 键 400", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/api/data-sources",
      cookies: { sid },
      payload: { kind: "monitor", name: "家庭服务器", config: { url: "http://127.0.0.1:61208" } },
    });
    expect(a.statusCode).toBe(201);
    monId = json(a).id as string;

    const dup = await app.inject({
      method: "POST",
      url: "/api/data-sources",
      cookies: { sid },
      payload: { kind: "monitor", name: "家庭服务器", config: {} },
    });
    expect(dup.statusCode).toBe(409);

    const bad = await app.inject({
      method: "POST",
      url: "/api/data-sources",
      cookies: { sid },
      payload: { kind: "monitor", name: "x", config: { evil: "1" } },
    });
    expect(bad.statusCode).toBe(400);

    const badKind = await app.inject({
      method: "POST",
      url: "/api/data-sources",
      cookies: { sid },
      payload: { kind: "mail", name: "x", config: {} },
    });
    expect(badKind.statusCode).toBe(400);
  });

  it("列表按 kind 过滤 + 改名换配置 + 删除", async () => {
    await app.inject({
      method: "POST",
      url: "/api/data-sources",
      cookies: { sid },
      payload: { kind: "opencode", name: "本机 OC", config: { url: "http://127.0.0.1:4096", apiToken: { credentialRef: "cred:xx" } } },
    });
    const monList = await app.inject({ method: "GET", url: "/api/data-sources?kind=monitor", cookies: { sid } });
    const rows = monList.json() as Array<{ id: string; name: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("家庭服务器");

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/data-sources/${monId}`,
      cookies: { sid },
      payload: { name: "客厅服务器", config: { url: "http://10.0.0.2:61208", authMode: "basic" } },
    });
    expect(patch.statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: `/api/data-sources/${monId}`, cookies: { sid } });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/data-sources?kind=monitor", cookies: { sid } });
    expect((after.json() as unknown[]).length).toBe(0);
  });

  it("kinds 契约（config 键白名单）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/data-sources/kinds", cookies: { sid } });
    const kinds = res.json() as Array<{ kind: string; configKeys: string[] }>;
    // Q39/D46：含第三方服务四类（immich/navidrome/portainer/mihomo）
    expect(kinds.map((k) => k.kind).sort()).toEqual([
      "http",
      "immich",
      "mihomo",
      "monitor",
      "navidrome",
      "opencode",
      "portainer",
    ]);
    expect(kinds.find((k) => k.kind === "monitor")?.configKeys).toContain("password");
    expect(kinds.find((k) => k.kind === "mihomo")?.configKeys).toContain("secret");
    expect(kinds.find((k) => k.kind === "immich")?.configKeys).toContain("apiKey");
  });

  it("Q31: GET 列表行携带解析后的 config 对象（前端契约）", async () => {
    await app.inject({
      method: "POST",
      url: "/api/data-sources",
      cookies: { sid },
      payload: { kind: "monitor", name: `q31-${Date.now()}`, config: { url: "http://127.0.0.1:61208" } },
    });
    const res = await app.inject({ method: "GET", url: "/api/data-sources?kind=monitor", cookies: { sid } });
    const rows = res.json() as Array<{ name: string; config?: unknown; configJson?: string }>;
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((r) => r.name.startsWith("q31-"))!;
    expect(typeof row.config).toBe("object");
    expect((row.config as Record<string, unknown>).url).toBe("http://127.0.0.1:61208");
  });
});
