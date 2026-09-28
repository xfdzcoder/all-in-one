export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",
  /** libsql local file path; override for tests / Docker volume. */
  databaseUrl: process.env.DATABASE_URL ?? "file:./data/app.db",
} as const;
