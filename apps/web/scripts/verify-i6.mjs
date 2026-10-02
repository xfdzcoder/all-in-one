/**
 * I6 acceptance (FR-I6 实时更新 + 轮询兜底): SSE 端点被拦截为 500（EventSource
 * 放弃重连）→ 宿主应在无任何用户操作的情况下按间隔轮询失效查询（观察 /api/todos
 * 自动请求）；正常 SSE 路径由 J4 等旅程覆盖。
 * Run: node scripts/verify-i6.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";
import { login, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

let todoHits = 0;
let eventHits = 0;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

try {
  // SSE 从一开始就不可用（反代/网关故障的等价情形）
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/events")) {
      eventHits++;
      void req.respond({ status: 500, contentType: "text/plain", body: "sse down" });
    } else {
      if (url.includes("/api/todos")) todoHits++;
      void req.continue();
    }
  });

  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
  await sleep(1500);

  ok("I6 SSE endpoint attempted then dead (500)", eventHits >= 1, `eventHits=${eventHits}`);

  // 无任何用户操作：30s 兜底轮询应触发数据查询（todo 自身的定时刷新是 60s，窗口内不重叠）
  const baseline = todoHits;
  await sleep(33_000);
  ok("I6 polling fallback fires without user action", todoHits > baseline, `${baseline} -> ${todoHits}`);

  // 应用仍正常可用（兜底不破坏常规交互）
  ok("I6 workbench still interactive", await page.evaluate(() => (document.body.textContent ?? "").includes("个人工作台")));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
