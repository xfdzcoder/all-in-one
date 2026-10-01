import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { parseRestartAllow, portainerRestart } from "./routes.ts";
import type { FetchContext } from "../connector/registry.ts";
import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { dataSource } from "../db/schema.ts";

/** Q56 契约测试（Portainer 容器重启，FR-X3f 写操作 D51）。 */

describe("parseRestartAllow（D51 白名单：空 = 禁止一切）", () => {
  it("逗号分隔 / 数组 / 空值", () => {
    expect(parseRestartAllow("web, db ,  ")).toEqual(["web", "db"]);
    expect(parseRestartAllow("web，db")).toEqual(["web", "db"]); // 全角逗号容错
    expect(parseRestartAllow(["web", " db "])).toEqual(["web", "db"]);
    expect(parseRestartAllow(undefined)).toEqual([]);
    expect(parseRestartAllow("")).toEqual([]);
    expect(parseRestartAllow(42)).toEqual([]);
  });
});

describe("portainerRestart（仅 restart + 白名单 + 名称校验）", () => {
  let dir: string;
  let client: Client;
  let db: Db;
  let ctx: FetchContext;
  let mock: Server;
  let base: string;
  const restarts: string[] = [];

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    dir = mkdtempSync(join(tmpdir(), "ail-pr-test-"));
    ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
    await ensureSchema(db);
    await ensureInitialUser(db);
    ctx = { db, userId: "", readSecret: async () => null } as FetchContext;
    mock = createServer((req, res) => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");
      if (url.includes("/restart") && req.method === "POST") {
        restarts.push(url);
        return res.end(JSON.stringify({ message: "restarted" }));
      }
      if (url.startsWith("/api/endpoints/1/docker/containers/json"))
        return res.end(
          JSON.stringify([
            { Id: "c-web", Names: ["/web"], State: "running", Status: "Up 1 day" },
            { Id: "c-db", Names: ["/db"], State: "running", Status: "Up 1 day" },
          ]),
        );
      if (url.startsWith("/api/endpoints")) return res.end(JSON.stringify([{ Id: 1, Name: "local" }]));
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

  const mkSource = async (name: string, config: Record<string, unknown>) => {
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    ctx.userId = user.id;
    const id = crypto.randomUUID();
    await db.insert(dataSource).values({
      id,
      userId: user.id,
      kind: "portainer",
      name,
      configJson: JSON.stringify({ url: base, apiToken: { credentialRef: "cred:none" }, ...config }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  };

  it("白名单为空 → 拒绝；非白名单容器 → 拒绝；白名单内 → restart 并回名称", async () => {
    const noAllow = await mkSource("pt-no-allow", {});
    await expect(portainerRestart(ctx, noAllow, "c-web")).rejects.toThrow("重启未开放");

    const allowOnlyWeb = await mkSource("pt-allow-web", { restartAllow: "web" });
    await expect(portainerRestart(ctx, allowOnlyWeb, "c-db")).rejects.toThrow("不在重启白名单内");
    const name = await portainerRestart(ctx, allowOnlyWeb, "c-web");
    expect(name).toBe("web");
    expect(restarts.some((r) => r.includes("/containers/c-web/restart"))).toBe(true);

    const wrongKind = crypto.randomUUID();
    const [user] = await db.select().from((await import("../db/schema.ts")).user).limit(1);
    await db.insert(dataSource).values({
      id: wrongKind,
      userId: user.id,
      kind: "mihomo",
      name: "mock-mihomo-for-pr",
      configJson: JSON.stringify({ url: base }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(portainerRestart(ctx, wrongKind, "c-web")).rejects.toThrow("需要 Portainer 连接");
  });
});
