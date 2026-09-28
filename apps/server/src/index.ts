import { startServer } from "./app.ts";

export const serviceName = "@all-in-one/server";

startServer().catch((err: unknown) => {
  console.error(`[${serviceName}] failed to start`, err);
  process.exit(1);
});
