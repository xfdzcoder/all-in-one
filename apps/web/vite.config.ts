import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
const proxy = {
  // Dev/preview: forward API calls to apps/server (same-origin cookies).
  "/api": "http://127.0.0.1:3000",
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
