/**
 * MON acceptance (Q9 服务器监控 · D36 打通第三方服务):
 *  ① Glances 形状监控源 → 指标卡（CPU/内存/负载）、磁盘进度条、运行时长、版本徽标；
 *  ② Basic 认证注入（凭证库口令 → Authorization，mock 计证）；
 *  ③ 手动刷新强制回源；④ 详情弹层（FR-I4）；⑤ 非 Glances 源 → 显式探测失败提示。
 * mock Glances API v4 在脚本内起 HTTP 服务（同 verify-j5/j6 模式）。
 * Run: node scripts/verify-mon.mjs (server :3000, preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let hits = 0;
let seenAuth = null;
const glances = createServer((req, res) => {
  hits++;
  seenAuth = req.headers.authorization ?? null;
  res.setHeader("Content-Type", "application/json");
  const key = (req.url ?? "").split("/").pop();
  const fixtures = {
    quicklook: { cpu: 23.5, mem: 61.2, load: 1.2, cpu_name: "Mock CPU", cpu_log_core: 8 },
    load: { cpucore: 8, min1: 1.2, min5: 0.8, min15: 0.4 },
    mem: { total: 8589934592, used: 5257150464, percent: 61.2 },
    fs: [
      { mnt_point: "/", percent: 77.4, size: 100000000000, used: 77400000000 },
      { mnt_point: "/backup", percent: 20.0, size: 200000000000, used: 40000000000 },
    ],
    uptime: JSON.stringify("5 days, 1:02:03"),
    version: JSON.stringify("4.9.0"),
  };
  if (key in fixtures) res.end(JSON.stringify(fixtures[key]));
  else res.writeHead(404).end();
});
await new Promise((r) => glances.listen(0, "127.0.0.1", r));
const glancesUrl = `http://127.0.0.1:${glances.address().port}`;

const weird = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ hello: "not glances" }));
});
await new Promise((r) => weird.listen(0, "127.0.0.1", r));
const weirdUrl = `http://127.0.0.1:${weird.address().port}`;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const clickBtn = (label, exact = false) =>
  page.evaluate(
    ({ l, ex }) => {
      const btns = [...document.querySelectorAll("button")];
      const btn = ex
        ? btns.find((b) => b.textContent.trim() === l)
        : btns.find((b) => b.textContent.trim().includes(l));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { l: label, ex: exact },
  );

const setField = (label, value) =>
  page.evaluate(
    ({ l, v }) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      const target = wrapper?.querySelector("input, textarea");
      if (!target) return false;
      const proto =
        target.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(target, v);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { l: label, v: value },
  );

const selectOption = async (label, optionText) => {
  await page.evaluate((l) => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes(l),
    );
    wrapper?.querySelector("[role=combobox]")?.click();
  }, label);
  await sleep(300);
  return page.evaluate((o) => {
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.textContent.includes(o));
    opt?.click();
    return Boolean(opt);
  }, optionText);
};

const addMonitorWidget = async (url, auth) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn("服务器监控"))) return false;
  await sleep(400);
  if (!(await setField("监控源地址", url))) return false;
  if (auth) {
    if (!(await selectOption("认证方式", "Basic"))) return false;
    if (!(await setField("用户名（Basic）", "glances"))) return false;
    if (!(await setField("口令 / 令牌", "s3cret"))) return false;
  }
  await sleep(200);
  return clickBtn("确认添加", true);
};

const clickRefreshIn = (marker) =>
  page.evaluate((m) => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(m));
    const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "刷新");
    if (!btn) return false;
    btn.click();
    return true;
  }, marker);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 前置：重置首页布局
  await page.evaluate(async () => {
    const seed = [
      { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
      { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
      { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
      { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
      { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
    ];
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页");
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // ①② 指标渲染 + Basic 认证注入
  ok("MON enter edit", await clickBtn("编辑布局"));
  await sleep(300);
  ok("MON add monitor widget", await addMonitorWidget(glancesUrl, true));
  await sleep(2500);
  const body = await page.evaluate(() => document.body.textContent ?? "");
  ok("MON version badge (probe)", body.includes("v4.9.0"), body.slice(-120));
  ok("MON cpu/mem/load cards", body.includes("23.5%") && body.includes("61.2%") && body.includes("1.2"), body.slice(-160));
  ok("MON uptime + cpu name shown", body.includes("5 天 1 小时 2 分") && body.includes("Mock CPU")); // ISS-18 本地化
  const progressCount = await page.evaluate(() => document.querySelectorAll(".mantine-Progress-root").length);
  ok("MON disk progress bars", body.includes("/backup") && progressCount >= 2, `progress=${progressCount}`);
  const expectedAuth = `Basic ${Buffer.from("glances:s3cret").toString("base64")}`;
  ok("MON basic auth injected from credential (SEC3)", seenAuth === expectedAuth, String(seenAuth));

  // ③ 手动刷新强制回源（浏览模式；数据通道 5s 最小间隔限流 —— 等待间隔后再验）
  ok("MON exit edit", await clickBtn("完成编辑"));
  await sleep(300);
  await sleep(5200);
  const h0 = hits;
  ok("MON refresh button", await clickRefreshIn("服务器监控"));
  await sleep(1500);
  ok("MON refresh refetches upstream", hits > h0, `${h0} -> ${hits}`);

  // ④ 详情弹层（FR-I4）
  ok("MON detail modal opens", await clickBtn("详情"));
  await sleep(500);
  const body2 = await page.evaluate(() => document.body.textContent ?? "");
  ok("MON detail shows raw metrics", body2.includes("详情 · 监控原始指标") && body2.includes("cpuName"), body2.slice(-120));
  await page.keyboard.press("Escape");
  await sleep(300);

  // ⑤ 非 Glances 源 → 显式探测失败
  ok("MON enter edit again", await clickBtn("编辑布局"));
  await sleep(300);
  ok("MON add widget against weird source", await addMonitorWidget(weirdUrl, false));
  await sleep(2500);
  const body3 = await page.evaluate(() => document.body.textContent ?? "");
  ok("MON incompatible source surfaced", body3.includes("无法读取监控源") && body3.includes("探测失败"), body3.slice(-160));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
glances.close();
weird.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
