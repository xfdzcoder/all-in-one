import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createDb, ensureSchema, type Client, type Db } from "../db/client.ts";
import { ensureInitialUser } from "../auth/ensure-user.ts";
import { seedDefaultDashboard } from "./seed.ts";
import { buildApp } from "../app.ts";

let dir: string;
let client: Client;
let db: Db;
let app: FastifyInstance;
let sid: string;

const ADMIN_PASSWORD = "test-admin-password-123";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ail-dash-test-"));
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
  await ensureInitialUser(db);
  await seedDefaultDashboard(db);
  app = buildApp({ db });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: ADMIN_PASSWORD },
  });
  sid = login.cookies.find((c) => c.name === "sid")?.value ?? "";
});

afterAll(async () => {
  await app.close();
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("dashboard CRUD (M1-④)", () => {
  it("seeds a default 首页 dashboard (J1)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboards", cookies: { sid } });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].title).toBe("首页");
    expect(JSON.parse(rows[0].layoutJson).length).toBeGreaterThan(0);
  });

  it("rejects unauthenticated access to business API", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboards" });
    expect(res.statusCode).toBe(401);
    const post = await app.inject({
      method: "POST",
      url: "/api/dashboards",
      payload: { title: "x" },
    });
    expect(post.statusCode).toBe(401);
  });

  it("creates, patches (incl. layoutJson), and deletes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/dashboards",
      cookies: { sid },
      payload: { title: "开发" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const layout = JSON.stringify([
      { id: "w1", x: 0, y: 0, w: 4, h: 2, component: "Placeholder", props: { title: "A" } },
    ]);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/dashboards/${id}`,
      cookies: { sid },
      payload: { layoutJson: layout, title: "开发2", icon: "🧪", background: "#102030" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe("开发2");
    expect(patched.json().layoutJson).toBe(layout);
    // FR-P9 页面级设置：图标 / 背景色
    expect(patched.json().icon).toBe("🧪");
    expect(patched.json().background).toBe("#102030");
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/dashboards/${id}`,
      cookies: { sid },
      payload: { background: null },
    });
    expect(cleared.json().background).toBeNull();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/dashboards/${id}`,
      cookies: { sid },
    });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({
      method: "PATCH",
      url: `/api/dashboards/${id}`,
      cookies: { sid },
      payload: { title: "x" },
    });
    expect(gone.statusCode).toBe(404);
  });

  it("validates layoutJson is a JSON array string", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/dashboards",
      cookies: { sid },
      payload: { title: "bad-layout" },
    });
    const id = created.json().id;
    const bad = await app.inject({
      method: "PATCH",
      url: `/api/dashboards/${id}`,
      cookies: { sid },
      payload: { layoutJson: "{not json" },
    });
    expect(bad.statusCode).toBe(400);
    const bad2 = await app.inject({
      method: "PATCH",
      url: `/api/dashboards/${id}`,
      cookies: { sid },
      payload: { layoutJson: JSON.stringify({ a: 1 }) },
    });
    expect(bad2.statusCode).toBe(400);
    await app.inject({ method: "DELETE", url: `/api/dashboards/${id}`, cookies: { sid } });
  });

  it("Q91/D58：columns / cellHeight 落库、缺省 12/80、非法值 400", async () => {
    // 缺省 → DB 默认 12 / 80
    const plain = await app.inject({
      method: "POST",
      url: "/api/dashboards",
      cookies: { sid },
      payload: { title: "grid-default" },
    });
    expect(plain.json().columns).toBe(12);
    expect(plain.json().cellHeight).toBe(80);

    // 显式指定档位
    const created = await app.inject({
      method: "POST",
      url: "/api/dashboards",
      cookies: { sid },
      payload: { title: "grid-24", columns: 24, cellHeight: 140 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().columns).toBe(24);
    expect(created.json().cellHeight).toBe(140);

    // PATCH 改档位
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/dashboards/${id}`,
      cookies: { sid },
      payload: { columns: 32, cellHeight: 60 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().columns).toBe(32);
    expect(patched.json().cellHeight).toBe(60);

    // 非法列数（不在 12/16/20/24/28/32 档位内）→ 400
    for (const bad of [0, 13, 31, 40, -4]) {
      const r = await app.inject({
        method: "PATCH",
        url: `/api/dashboards/${id}`,
        cookies: { sid },
        payload: { columns: bad },
      });
      expect(r.statusCode).toBe(400);
    }
    // 行高越界 → 400
    for (const bad of [0, 39, 201, 1000]) {
      const r = await app.inject({
        method: "PATCH",
        url: `/api/dashboards/${id}`,
        cookies: { sid },
        payload: { cellHeight: bad },
      });
      expect(r.statusCode).toBe(400);
    }
    await app.inject({ method: "DELETE", url: `/api/dashboards/${id}`, cookies: { sid } });
    await app.inject({ method: "DELETE", url: `/api/dashboards/${plain.json().id}`, cookies: { sid } });
  });

  it("serves OpenAPI doc generated from zod schemas (D11)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/dashboards"]).toBeTruthy();
    expect(doc.paths["/api/dashboards/{id}"].patch).toBeTruthy();
  });
});
