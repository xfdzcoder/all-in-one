import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude dist/ — tsc output duplicates the tests and would double-run them.
    include: ["src/**/*.test.ts"],
  },
});
