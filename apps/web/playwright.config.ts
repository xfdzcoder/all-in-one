import { defineConfig } from "@playwright/test";

/** D15：Playwright 覆盖 J1–J4（MVP 出口门槛之一）。
 *  用系统 Chrome（channel: chrome）——本机已有 /usr/bin/google-chrome。
 *  需 server :3000 + web preview :4173 同时在跑（见 scripts/README 注释）。 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
  },
});
