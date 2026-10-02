import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/** D15：Playwright 覆盖 J1–J4（MVP 出口门槛之一）。
 *  用系统 Chrome —— `channel: "chrome"` 只认标准安装路径（/opt/google/chrome），
 *  Debian 系的 /usr/bin/google-chrome 需显式 executablePath（按存在性定向，保持可移植）。
 *  需 server :3000 + web preview :4173 同时在跑（见 scripts/README 注释）。 */
const chromePath = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome"].find((p) => existsSync(p));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
    ...(chromePath ? { launchOptions: { executablePath: chromePath } } : { channel: "chrome" as const }),
    viewport: { width: 1400, height: 900 },
  },
});
