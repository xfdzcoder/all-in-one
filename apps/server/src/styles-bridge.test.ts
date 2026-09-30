import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "./db/client.ts";
import { buildApp } from "./app.ts";
import { MANTINE_BRIDGE_CSS } from "./styles-bridge.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  dir = mkdtempSync(join(tmpdir(), "ail-css-test-"));
  const url = `file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`;
  process.env.DATABASE_URL = url;
  ({ client, db } = await createDb(url));
  await ensureSchema(db);
  app = buildApp({ db });
  await app.ready();
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /custom.css（样式定制层，Q19b）", () => {
  it("无用户样式时下发 Mantine 桥 + 占位说明（零 404）", async () => {
    const res = await app.inject({ method: "GET", url: "/custom.css" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.body.startsWith(MANTINE_BRIDGE_CSS)).toBe(true);
    expect(res.body).toContain("--mantine-color-dimmed: var(--wb-color-text-muted)");
    expect(res.body).toContain("自定义样式写入");
  });

  it("用户段永远拼接在桥接段之后（后写覆盖前写）", async () => {
    writeFileSync(join(dir, "custom.css"), ":root { --wb-color-accent: hotpink; }\n");
    const res = await app.inject({ method: "GET", url: "/custom.css" });
    const bridgeAt = res.body.indexOf("Mantine 令牌桥");
    const userAt = res.body.indexOf("--wb-color-accent: hotpink");
    expect(bridgeAt).toBeGreaterThanOrEqual(0);
    expect(userAt).toBeGreaterThan(bridgeAt);
    expect(res.body.indexOf("用户自定义")).toBeLessThan(userAt);
  });
});
