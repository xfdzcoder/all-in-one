/**
 * capture-style-variants —— Q58 视觉风格样张管线（UI 现代化阶段 0）：
 * 在验证栈页面注入实验 CSS，产出风格样张截图供用户圈定方向（A 克制精致为主，
 * 变体 = A+玻璃光感背景 / A+柔和圆角）。实验 CSS 仅注入不入库（落地见 Q59–Q64）。
 * Run: node scripts/capture-style-variants.mjs (server :3001, preview :4173)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { ADMIN_PASSWORD } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const OUT = join(import.meta.dirname, "../../../docs/design-audit/style-v2");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A · 克制精致（Linear/Vercel）：tinted 深色分层 + 微光边框 + 展示级数字 + 渐变按钮。 */
const STYLE_A = `
:root {
  --wb-color-bg: #0a0d14;
  --wb-color-surface: #111621;
  --wb-color-surface-hover: #171d2b;
  --wb-color-surface-raised: #1c2333;
  --wb-color-border: rgba(140, 168, 255, 0.10);
  --wb-color-border-strong: rgba(140, 168, 255, 0.24);
  --wb-color-text: #eef2fa;
  --wb-color-text-secondary: #bac4d8;
  --wb-color-text-muted: #8b93a8;
  --wb-color-accent: #4f7dff;
  --wb-color-accent-hover: #6a92ff;
  --wb-radius-sm: 8px;
  --wb-radius-md: 12px;
  --wb-radius-lg: 16px;
  --wb-font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
}
body {
  background:
    radial-gradient(1200px 480px at 20% -10%, rgba(79, 125, 255, 0.16), transparent 60%),
    radial-gradient(900px 420px at 90% -20%, rgba(120, 90, 255, 0.10), transparent 55%),
    var(--wb-color-bg);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.005em;
}
.wb-widget {
  background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)), var(--wb-color-surface);
  border: 1px solid var(--wb-color-border);
  border-radius: var(--wb-radius-lg);
  box-shadow: 0 1px 2px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.28);
}
.wb-metric--primary .mantine-Text:not([class*="dimmed"]) {
  font-size: 28px; font-weight: 700; letter-spacing: -0.02em;
}
.mantine-Button-filled {
  background: linear-gradient(180deg, #5b86ff, #3f63e8) !important;
  border: 1px solid rgba(140, 168, 255, 0.35) !important;
  box-shadow: 0 4px 14px rgba(63, 99, 232, 0.35) !important;
}
.mantine-Badge-root { border-radius: 999px; }
.mantine-Card-root { border-radius: var(--wb-radius-md); }
`;

/** 变体 B：A + 玻璃光感背景点缀（半透明卡片 + 氛围光斑更明显）。 */
const STYLE_GLASS = `
.wb-widget {
  background: rgba(22, 28, 42, 0.55) !important;
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  border: 1px solid rgba(140, 168, 255, 0.18) !important;
  box-shadow: 0 16px 48px rgba(0,0,0,0.38) !important;
}
body {
  background:
    radial-gradient(1000px 600px at 12% -8%, rgba(64, 120, 255, 0.28), transparent 62%),
    radial-gradient(1100px 520px at 95% 0%, rgba(158, 102, 255, 0.22), transparent 58%),
    radial-gradient(800px 500px at 50% 110%, rgba(42, 196, 176, 0.12), transparent 60%),
    #0a0d14 !important;
}
`;

/** 变体 C：A + 柔和圆角点缀（更大圆角、软阴影、pill 化）。 */
const STYLE_SOFT = `
:root {
  --wb-radius-sm: 12px;
  --wb-radius-md: 16px;
  --wb-radius-lg: 22px;
}
.wb-widget {
  border-radius: var(--wb-radius-lg) !important;
  border: 1px solid rgba(140, 168, 255, 0.12) !important;
  box-shadow: 0 2px 6px rgba(0,0,0,0.22), 0 20px 48px rgba(0,0,0,0.22) !important;
}
.mantine-Button-root { border-radius: 999px !important; }
.mantine-Card-root { border-radius: 18px !important; }
.wb-gallery__cell { border-radius: 14px !important; }
`;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

await page.goto(WEB, { waitUntil: "networkidle0" });
await page.type("input[autocomplete=username]", "admin");
await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector(".grid-stack", { timeout: 15000 });
await sleep(2500);

// 字体：Inter 尽力加载（离线则回落 system-ui）
await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" }).catch(() => undefined);
await sleep(1200);

await page.screenshot({ path: join(OUT, "00-current.png") });
console.log("saved 00-current.png");

for (const [name, css] of [
  ["01-style-a", STYLE_A],
  ["02-style-a-glass", STYLE_A + STYLE_GLASS],
  ["03-style-a-soft", STYLE_A + STYLE_SOFT],
]) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
  await sleep(1800);
  await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" }).catch(() => undefined);
  await page.addStyleTag({ content: css });
  await sleep(800);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`saved ${name}.png`);
}

await browser.close();
