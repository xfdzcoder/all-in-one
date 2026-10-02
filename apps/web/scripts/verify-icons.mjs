/**
 * ICON acceptance（Q38b 自定义图标库，D45）：
 *  ① 上传 PNG → 清单出现 + 预览加载；② 上传含脚本 SVG → 落库内容已净化（无 <script/onload>）；
 *  ③ 复制引用地址 → /api/icons/:id 可取（CSP sandbox + nosniff 头）；④ 删除带确认（D31）→ 行消失。
 * Run: node scripts/verify-icons.mjs (server :3000, preview :4173)
 */
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { ADMIN_PASSWORD, makeOk, openSettings, sleep, uniqId } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）
const uniq = uniqId(); // TST-8：时间戳+随机，防同毫秒重名/残留互撞

const dir = mkdtempSync(join(tmpdir(), "ail-icons-"));
const pngPath = join(dir, "icon.png");
writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const svgPath = join(dir, "evil.svg");
writeFileSync(svgPath, `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 16 16"><script>alert(2)</script><rect width="16" height="16" fill="#4a6fa5"/></svg>`);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
  await sleep(400);

  ok("ICONS open data source panel", await openSettings(page, "数据源"));
  await sleep(500);
  await page.evaluate(() =>
    [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "图标")?.click(),
  );
  await sleep(300);

  // ① 上传 PNG
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "＋ 上传图标")?.click(),
  );
  await sleep(300);
  await page.evaluate((n) => {
    const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === "图标名称");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, n);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, `png-icon-${uniq}`);
  const fileInput = await page.$('input[aria-label="图标文件"]');
  await fileInput.uploadFile(pngPath);
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "上传")?.click());
  await sleep(1000);
  ok(
    "ICON png uploaded and listed",
    await page.evaluate((n) => {
      const row = [...document.querySelectorAll('[data-admin-row="icon"]')].find((r) => r.textContent.includes(n));
      return Boolean(row?.querySelector("img"));
    }, `png-icon-${uniq}`),
  );

  // ② 上传含脚本 SVG（净化验证）
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "＋ 上传图标")?.click(),
  );
  await sleep(300);
  await page.evaluate((n) => {
    const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === "图标名称");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, n);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, `svg-icon-${uniq}`);
  const fileInput2 = await page.$('input[aria-label="图标文件"]');
  await fileInput2.uploadFile(svgPath);
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "上传")?.click());
  await sleep(1000);
  const svgCheck = await page.evaluate(async (n) => {
    const rows = await (await fetch("/api/icons")).json();
    const row = rows.find((r) => r.name === n);
    if (!row) return { listed: false };
    const res = await fetch(`/api/icons/${row.id}`);
    const body = await res.text();
    return {
      listed: true,
      clean: !body.includes("<script") && !body.includes("onload"),
      csp: res.headers.get("content-security-policy") ?? "",
      nosniff: res.headers.get("x-content-type-options"),
      id: row.id,
    };
  }, `svg-icon-${uniq}`);
  ok("ICON svg listed + sanitized (no script/onload)", svgCheck.listed && svgCheck.clean, JSON.stringify(svgCheck).slice(0, 120));
  ok("ICON file served with CSP sandbox + nosniff", svgCheck.csp.includes("sandbox") && svgCheck.nosniff === "nosniff");

  // ③ 复制引用地址（2s 复位）
  ok(
    "ICON copy reference",
    await page.evaluate((n) => {
      const row = [...document.querySelectorAll('[data-admin-row="icon"]')].find((r) => r.textContent.includes(n));
      const btn = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes("复制地址"));
      btn?.click();
      return Boolean(btn);
    }, `png-icon-${uniq}`),
  );
  await sleep(300);
  ok("ICON copied state shown", await page.evaluate(() => (document.body.textContent ?? "").includes("已复制")));

  // ④ 删除带确认（D31）
  await page.evaluate((n) => {
    const row = [...document.querySelectorAll('[data-admin-row="icon"]')].find((r) => r.textContent.includes(n));
    [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "删除")?.click();
  }, `svg-icon-${uniq}`);
  await sleep(400);
  ok("ICON delete confirm names the icon", await page.evaluate((n) => (document.body.textContent ?? "").includes(`确认删除图标「${n}」`), `svg-icon-${uniq}`));
  await page.evaluate(() =>
    [...document.querySelectorAll(".mantine-Modal-root button")]
      .findLast((b) => b.offsetParent !== null && b.textContent.trim() === "确认")
      ?.click(),
  );
  await sleep(800);
  ok(
    "ICON deleted after confirm",
    await page.evaluate(
      (n) => ![...document.querySelectorAll('[data-admin-row="icon"]')].some((r) => r.textContent.includes(n)),
      `svg-icon-${uniq}`,
    ),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
