/**
 * One-shot smoke for M1-② + M1-③: schema, health, account init, login session.
 * Run: node scripts/smoke-m1b.ts
 */
import { rmSync } from "node:fs";
import { createDb, ensureSchema } from "../src/db/client.ts";
import { buildApp } from "../src/app.ts";
import { ensureInitialUser } from "../src/auth/ensure-user.ts";

const databaseUrl = `file:/tmp/ail-m1b-smoke-${process.pid}.db`;
rmSync(databaseUrl.replace("file:", ""), { force: true });
const { client, db } = createDb(databaseUrl);
await ensureSchema(client);

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
);
const journal = await client.execute("PRAGMA journal_mode");
console.log("tables", tables.rows);
console.log("journal", journal.rows);

const init = await ensureInitialUser(db);
console.log("init", init.created ? `created ${init.username}` : `exists ${init.username}`);

const app = buildApp({ db });
const health = await app.inject({ method: "GET", url: "/api/health" });
console.log("health", health.statusCode, health.body);

const login = await app.inject({
  method: "POST",
  url: "/api/auth/login",
  payload: {
    username: init.username,
    password: init.created ? init.password : "unreachable",
  },
});
const cookie = login.cookies.find((c) => c.name === "sid");
console.log("login", login.statusCode, "cookie?", Boolean(cookie?.value));

const me = await app.inject({
  method: "GET",
  url: "/api/auth/me",
  cookies: cookie ? { sid: cookie.value } : {},
});
console.log("me", me.statusCode, me.body);

const bad = await app.inject({
  method: "POST",
  url: "/api/auth/login",
  payload: { username: init.username, password: "wrong" },
});
console.log("bad-login", bad.statusCode);

await app.close();
client.close();

const ok =
  health.statusCode === 200 &&
  login.statusCode === 200 &&
  Boolean(cookie?.value) &&
  me.statusCode === 200 &&
  bad.statusCode === 401;
if (!ok) {
  console.error("SMOKE FAIL");
  process.exit(1);
}
console.log("SMOKE OK");
