/**
 * NFR3 首屏性能（局域网内首屏可交互 < 2s）：
 *  - 登录页可交互耗时；
 *  - 登录后首屏（.grid-stack 出现 = 工作台可交互）3 次采样取中位数。
 * 测量环境 = localhost（应用自身开销；LAN 部署另有网络跳数，见 docs/deploy.md）。
 * Run: node scripts/verify-nfr3.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

try {
  // 登录页：导航 → 表单可交互
  const t0 = Date.now();
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  const loginMs = Date.now() - t0;
  ok("NFR3 login screen interactive < 2s", loginMs < 2000, `${loginMs}ms`);

  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 首屏（登录后工作台）3 次采样（reload 后 .grid-stack 出现 = 可交互）
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".grid-stack", { timeout: 8000 });
    samples.push(Date.now() - t);
    await sleep(300);
  }
  const median = [...samples].toSorted((a, b) => a - b)[Math.floor(samples.length / 2)];
  ok("NFR3 first-screen interactive median < 2s", median < 2000, `samples=${JSON.stringify(samples)} median=${median}ms`);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
