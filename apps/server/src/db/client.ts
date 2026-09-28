import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { config } from "../config.ts";
import * as schema from "./schema.ts";

export type Db = LibSQLDatabase<typeof schema>;
export type { Client };

function prepareFileUrl(url: string): void {
  if (!url.startsWith("file:")) return;
  const path = fileURLToPath(url);
  mkdirSync(dirname(path), { recursive: true });
}

export function createDb(databaseUrl: string = config.databaseUrl): {
  client: Client;
  db: Db;
} {
  prepareFileUrl(databaseUrl);
  const client = createClient({ url: databaseUrl });
  // WAL is the frozen SQLite posture (04-tech-stack); harmless if already set.
  void client.execute("PRAGMA journal_mode = WAL");
  void client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  return { client, db };
}

export async function ensureSchema(client: Client): Promise<void> {
  await client.executeMultiple(schema.SCHEMA_DDL);
}
