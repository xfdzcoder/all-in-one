import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import "gridstack/dist/gridstack.css";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App.tsx";
import { installErrorNet } from "./feedback.ts";

installErrorNet(); // WEB-4（Q99d）：未接住的 Promise 拒绝不静默

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
