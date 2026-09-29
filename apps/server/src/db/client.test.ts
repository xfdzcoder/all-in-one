import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, ensureSchema, type Client, type Db } from "./client.ts";

let dir: string;
let client: Client;
let db: Db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ail-db-test-"));
  ({ client, db } = await createDb(`file:${join(dir, `t-${randomBytes(4).toString("hex")}.db`)}`));
  await ensureSchema(db);
});

afterAll(() => {
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("db schema (D18 migrations)", () => {
  it("creates user/dashboard/session tables", async () => {
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.rows.map((r) => String(r.name));
    expect(names).toEqual(expect.arrayContaining(["user", "dashboard", "session"]));
  });

  it("runs in WAL mode with foreign_keys on (D16/D20)", async () => {
    const journal = await client.execute("PRAGMA journal_mode");
    expect(String(journal.rows[0].journal_mode).toLowerCase()).toBe("wal");
    const fk = await client.execute("PRAGMA foreign_keys");
    expect(Number(fk.rows[0].foreign_keys)).toBe(1);
  });

  it("applies migrations idempotently (re-run is a no-op)", async () => {
    await ensureSchema(db);
    const versions = await client.execute("SELECT count(*) AS n FROM __drizzle_migrations");
    expect(Number(versions.rows[0].n)).toBeGreaterThan(0);
    // re-run again after data exists must not throw
    await ensureSchema(db);
    const users = await client.execute("SELECT count(*) AS n FROM user");
    expect(Number(users.rows[0].n)).toBe(0);
  });
});
