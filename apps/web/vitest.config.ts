import { defineConfig } from "vitest/config";

/**
 * apps/web 的单测只覆盖 `src/` 下的纯逻辑（如 media-wall-layout）。
 *
 * `e2e/*.spec.ts` 是 **Playwright** 用例（`@playwright/test` 的 `test`），
 * 不是 vitest 用例 —— 必须排除，否则 vitest 会去跑它并因缺少 Playwright 夹具而失败。
 * E2E 走 `pnpm --filter @all-in-one/web exec playwright test`（M3 J1–J4）。
 */
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    environment: "node",
  },
});
