import { defineConfig } from "drizzle-kit";

/** D18: schema.ts is the single source of truth; `pnpm --filter @all-in-one/server
 *  exec drizzle-kit generate` writes SQL migrations applied at boot by migrator. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
