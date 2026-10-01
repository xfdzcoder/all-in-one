import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { navidromeControl, navidromeControlPath } from "./routes.ts";
import type { FetchContext } from "../connector/registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q55 契约测试（Navidrome 播放遥控，FR-X3e 写操作 D51）。 */

describe("navidromeControlPath（D51）", () => {
  it("动作映射到 Subsonic 控制端点", () => {
    expect(navidromeControlPath("play")).toBe("/rest/pause.view?paused=false");
    expect(navidromeControlPath("pause")).toBe("/rest/pause.view?paused=true");
    expect(navidromeControlPath("next")).toBe("/rest/next.view");
    expect(navidromeControlPath("prev")).toBe("/rest/previous.view");
    expect(navidromeControlPath("stop")).toBe("/rest/stop.view");
  });
});

describe("navidromeControl（写操作 + 来源校验）", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;
  const hits: string[] = [];

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-nc-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    mock = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ "subsonic-response": { status: "ok" } }));
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    mock?.close();
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("派发控制到 Subsonic；非 Navidrome 连接拒绝（写操作边界）", async () => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "navidrome",
      name: "mock-nd-ctrl",
      configJson: JSON.stringify({ url: base, username: "u", password: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await navidromeControl(ctx, id, "next");
    expect(hits.some((h) => h.startsWith("/rest/next.view"))).toBe(true);

    const wrongKind = crypto.randomUUID();
    await db.insert(dataSource).values({
      id: wrongKind,
      userId: user.id,
      kind: "mihomo",
      name: "mock-mihomo-for-nc",
      configJson: JSON.stringify({ url: base }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(navidromeControl(ctx, wrongKind, "play")).rejects.toThrow("播放遥控需要 Navidrome 连接");
    await expect(navidromeControl(ctx, "nope", "play")).rejects.toThrow("数据连接不存在");
  });
});
