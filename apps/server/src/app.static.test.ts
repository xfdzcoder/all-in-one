import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "./db/client.ts";
import { ensureInitialUser } from "./auth/ensure-user.ts";
import { buildApp } from "./app.ts";

let dir: string;
let pub: string;
let client: Client;
let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ail-static-test-"));
  pub = join(dir, "public");
  mkdirSync(pub);
  writeFileSync(join(pub, "index.html"), "<html>app-shell</html>");
  writeFileSync(join(pub, "ok.js"), "export const ok = 1;");
  // 秘密文件放在 PUBLIC_DIR **之外** —— 穿越修不好它就会被回发
  writeFileSync(join(dir, "secret.txt"), "TOP-SECRET-DO-NOT-SERVE");
  process.env.ADMIN_PASSWORD = "test-admin-password-123";
  process.env.PUBLIC_DIR = pub;
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
  await ensureInitialUser(db);
  app = buildApp({ db });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  client.close();
  delete process.env.PUBLIC_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("PUBLIC_DIR 静态伺服（SRV-02 路径穿越回归）", () => {
  it("serves real assets and SPA fallback", async () => {
    const asset = await app.inject({ method: "GET", url: "/ok.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("ok = 1");
    const spa = await app.inject({ method: "GET", url: "/some/spa/route" });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("app-shell");
  });

  it("never serves files outside PUBLIC_DIR (raw + encoded traversal)", async () => {
    for (const url of [
      "/%2e%2e/secret.txt", // 百分号编码（路由器不归一，直达 handler）
      "/..%2fsecret.txt",
      "/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
      "/../secret.txt",
      "/../../etc/passwd",
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    ]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.body, url).not.toContain("TOP-SECRET-DO-NOT-SERVE");
      expect(r.body, url).not.toContain("root:x:");
      expect(r.body, url).toContain("app-shell"); // 越界一律走 SPA fallback
    }
  });

  it("rejects malformed percent-encoding instead of throwing", async () => {
    const r = await app.inject({ method: "GET", url: "/%zz" });
    expect([200, 400]).toContain(r.statusCode);
    expect(r.body).not.toContain("TOP-SECRET-DO-NOT-SERVE");
  });
});
