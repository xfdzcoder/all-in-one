import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
const proxy = {
  // Dev/preview: forward API calls to apps/server (same-origin cookies).
  // 可用 VITE_API_PROXY 覆盖（如并行跑多套实例：VITE_API_PROXY=http://127.0.0.1:3001）
  "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:3000",
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
