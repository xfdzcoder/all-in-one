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
  // Q115 批1（dev 脚本体积治理）：依赖预构建默认不压缩（可读性），代价是 dev 下
  // Mantine/react-dom 等数 MB 的未压缩脚本 —— DevTools 要逐个解析/索引，面板直接卡死。
  // 压缩预构建包显著降低该压力；调试 node_modules 需要时临时注释掉本行即可。
  optimizeDeps: { esbuildOptions: { minify: true } },
  server: { proxy },
  preview: { proxy },
});
