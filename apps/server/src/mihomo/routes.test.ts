import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { mihomoSelect } from "./routes.ts";
import type { FetchContext } from "../connector/registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q57 契约测试（Mihomo 策略组切换，FR-X3g 写操作 D51）。 */

describe("mihomoSelect（成员校验 + 切换 + 审计信息）", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;
  const puts: string[] = [];

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-ms-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    mock = createServer((req, res) => {
      const url = decodeURIComponent(req.url ?? "");
      res.setHeader("Content-Type", "application/json");
      if (req.method === "PUT" && url.startsWith("/proxies/")) {
        puts.push(url);
        return res.end(JSON.stringify({ message: "ok" }));
      }
      if (url.startsWith("/proxies"))
        return res.end(
          JSON.stringify({
            proxies: {
              GLOBAL: { now: "DIRECT", all: ["DIRECT", "香港", "日本"], history: [] },
              DIRECT: { type: "Direct", history: [] },
            },
          }),
        );
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    mock?.close();
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("非成员拒绝 / 非组拒绝 / 成员切换回 当前→目标", async () => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "mihomo",
      name: "mock-mihomo-select",
      configJson: JSON.stringify({ url: base, secret: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(mihomoSelect(ctx, id, "GLOBAL", "美国")).rejects.toThrow("不是「GLOBAL」的成员");
    await expect(mihomoSelect(ctx, id, "DIRECT", "DIRECT")).rejects.toThrow("不是可切换的策略组");

    const r = await mihomoSelect(ctx, id, "GLOBAL", "香港");
    expect(r).toEqual({ from: "DIRECT", to: "香港" });
    expect(puts.some((p) => p.startsWith("/proxies/GLOBAL"))).toBe(true);

    const wrongKind = crypto.randomUUID();
    await db.insert(dataSource).values({
      id: wrongKind,
      userId: user.id,
      kind: "portainer",
      name: "mock-pt-for-ms",
      configJson: JSON.stringify({ url: base, apiToken: { credentialRef: "cred:none" } }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(mihomoSelect(ctx, wrongKind, "GLOBAL", "香港")).rejects.toThrow("需要 Mihomo 连接");
  });
});
