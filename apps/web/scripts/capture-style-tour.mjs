/**
 * capture-style-tour —— Q64 视觉走查管线（D52 批5 收尾）：
 * 产出关键表面走查图（登录 / 工作台 / 编辑态 / 配置弹窗 / 组件选择器 / 浅色工作台）。
 * Run: node scripts/capture-style-tour.mjs (server :3001, preview :4173)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const OUT = join(import.meta.dirname, "../../../docs/design-audit/style-v2");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const clickBtn = (label) =>
  page.evaluate((l) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.getAttribute("aria-label") || b.textContent || "").trim().includes(l),
    );
    btn?.click();
    return Boolean(btn);
  }, label);

const shot = async (name) => {
  await sleep(600);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`saved ${name}.png`);
};

// 1) 登录页
await page.goto(WEB, { waitUntil: "networkidle0" });
await shot("10-tour-login");

// 2) 工作台（深色）
await page.type("input[autocomplete=username]", "admin");
await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
await page.click("button[type=submit]");
await page.waitForSelector(".grid-stack", { timeout: 15000 });
await sleep(2200);
await shot("11-tour-workspace-dark");

// 3) 编辑态（chrome 动作）
await clickBtn("编辑页面");
await sleep(500);
await shot("12-tour-edit-mode");

// 4) 配置弹窗
const configured = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.textContent.includes("Todo"));
  const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => (b.getAttribute("aria-label") || b.textContent).includes("配置"));
  btn?.click();
  return Boolean(btn);
});
if (configured) await shot("13-tour-config-modal");
await page.keyboard.press("Escape");
await sleep(400);

// 5) 组件选择器
await clickBtn("添加组件");
await sleep(500);
await shot("14-tour-picker");
await page.keyboard.press("Escape");
await sleep(300);
await clickBtn("完成编辑");
await sleep(300);

// 6) 浅色工作台
await page.evaluate(() => localStorage.setItem("wb-theme", "light"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".grid-stack", { timeout: 15000 });
await sleep(2200);
await shot("15-tour-workspace-light");

await browser.close();
