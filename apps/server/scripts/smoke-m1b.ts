/**
 * One-shot smoke for M1-②: schema ensure + health route. Not a Vitest suite.
 * Run: node scripts/smoke-m1b.ts
 */
import { createDb, ensureSchema } from "../src/db/client.ts";
import { buildApp } from "../src/app.ts";

const databaseUrl = "file:/tmp/ail-m1b-smoke.db";
const { client, db } = createDb(databaseUrl);
await ensureSchema(client);

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
);
const journal = await client.execute("PRAGMA journal_mode");
console.log("tables", tables.rows);
console.log("journal", journal.rows);

const app = buildApp({ db });
const res = await app.inject({ method: "GET", url: "/api/health" });
console.log("health", res.statusCode, res.body);
await app.close();
client.close();

if (res.statusCode !== 200) {
  console.error("SMOKE FAIL");
  process.exit(1);
}
console.log("SMOKE OK");
