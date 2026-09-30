import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
const target = process.env.VITE_API_PROXY ?? "http://127.0.0.1:3000";
const proxy = {
  // Dev/preview: forward API calls to apps/server (same-origin cookies).
  // 可用 VITE_API_PROXY 覆盖（如并行跑多套实例：VITE_API_PROXY=http://127.0.0.1:3001）
  "/api": target,
  // 样式定制层（Q19b）：服务端合成（Mantine 桥 + ./data/custom.css），必须走代理，
  // 否则 SPA fallback 把它当 HTML 返回（样式表被浏览器拒收）
  "/custom.css": target,
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
