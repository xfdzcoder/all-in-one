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
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";

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
      // Q37：容器化 Glances 的真实形态 —— 同卷多条 bind mount + 一条干净挂载点
      { device_name: "/dev/mapper/mock-root", mnt_point: "/usr/lib/os-release", percent: 77.4, size: 100000000000, used: 77400000000 },
      { device_name: "/dev/mapper/mock-root", mnt_point: "/host/etc", percent: 77.4, size: 100000000000, used: 77400000000 },
      { device_name: "/dev/mapper/mock-root", mnt_point: "/etc/glances/glances.conf", percent: 77.4, size: 100000000000, used: 77400000000 },
      { device_name: "/dev/mapper/mock-var", mnt_point: "/etc/hosts", percent: 87.0, size: 58000000000, used: 50460000000 },
      { device_name: "/dev/sdb1", mnt_point: "/backup", percent: 20.0, size: 200000000000, used: 40000000000 },
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

const createMonitorSource = (name, url, auth) =>
  page.evaluate(
    async ({ name, url, auth }) => {
      let apiToken;
      if (auth) {
        // SEC3：令牌入凭证库，连接仅存引用
        const cred = await (
          await fetch("/api/credentials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `${name}-cred`, kind: "http-header", secret: "s3cret" }),
          })
        ).json();
        apiToken = { credentialRef: cred.id };
      }
      const res = await fetch("/api/data-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "monitor",
          name,
          config: auth ? { url, authMode: "basic", username: "glances", apiToken } : { url },
        }),
      });
      return res.ok;
    },
    { name, url, auth },
  );

// Q36：添加组件 = 只选监控源（连接信息不在组件表单重填）
const addMonitorWidget = async (sourceName) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn("服务器监控"))) return false;
  await sleep(400);
  const selectOnly = await page.evaluate(
    () => ![...document.querySelectorAll(".mantine-Modal-root label")].some((l) => l.textContent.includes("监控源地址")),
  );
  if (!selectOnly) return false;
  if (!(await selectOption("监控源", sourceName))) return false;
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
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

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
    const home = list.find((d) => d.title === "首页") ?? list[0]; // 回落首屏：真机/历史库可能没有「首页」（Q82 同款，TST-10）
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // 前置：监控源连接（数据源管理 · 数据连接 —— 组件只做选择，Q36）
  const srcBasic = `mon-basic-${Date.now().toString(36).slice(-4)}`;
  const srcWeird = `mon-plain-${Date.now().toString(36).slice(-4)}`;
  ok("MON create source with basic auth (credential-backed)", await createMonitorSource(srcBasic, glancesUrl, true));
  ok("MON create plain source for incompatible case", await createMonitorSource(srcWeird, weirdUrl, false));

  // ①② 指标渲染 + Basic 认证注入
  ok("MON enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("MON add monitor widget (select-only form)", await addMonitorWidget(srcBasic));
  await sleep(2500);
  const body = await page.evaluate(() => document.body.textContent ?? "");
  ok("MON version badge (probe)", body.includes("v4.9.0"), body.slice(-120));
  ok("MON cpu/mem/load cards", body.includes("23.5%") && body.includes("61.2%") && body.includes("1.2"), body.slice(-160));
  ok("MON uptime + cpu name shown", body.includes("5 天 1 小时 2 分") && body.includes("Mock CPU")); // ISS-18 本地化
  const progressCount = await page.evaluate(() => document.querySelectorAll(".mantine-Progress-root").length);
  // Q37：同卷 bind mount 去重（5 条原始 → 2 卷 + /backup = 3 行）、噪声挂载点不外泄、设备名回退
  ok(
    "MON storage deduped per volume (Q37)",
    body.includes("/backup") && body.includes("mock-root") && !body.includes("/etc/hosts") && progressCount === 3,
    `progress=${progressCount}`,
  );
  // Q37：CPU/内存/负载三卡等高
  const cardHeights = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".mantine-Card-root")]
      .filter((c) => ["CPU", "内存", "负载"].some((l) => c.textContent.trim().startsWith(l)))
      .map((c) => Math.round(c.getBoundingClientRect().height));
    return cards;
  });
  ok(
    "MON metric cards equal heights (Q37)",
    cardHeights.length === 3 && cardHeights.every((h) => h === cardHeights[0]),
    JSON.stringify(cardHeights),
  );
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
  ok("MON enter edit again", await clickBtn("编辑页面"));
  await sleep(300);
  ok("MON add widget against weird source", await addMonitorWidget(srcWeird));
  await sleep(2500);
  const body3 = await page.evaluate(() => document.body.textContent ?? "");
  ok("MON incompatible source surfaced", body3.includes("无法读取监控源") && body3.includes("探测失败"), body3.slice(-160));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
glances.close();
weird.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
