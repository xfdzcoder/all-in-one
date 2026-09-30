/**
 * SVC acceptance（Q39 第三方服务接入 · D46 连接+概览展示）：
 *  ① 数据源管理建四类服务连接（mihomo/portainer/navidrome/immich，mock API）；
 *  ② 「服务概览」组件选连接 → 探活徽标 + 版本 + 各服务关键计数；
 *  ③ 官方品牌图标随连接展示；④ 坏连接 → 显式「探测失败」提示。
 * mock 服务在脚本内起 HTTP（同 verify-mon 模式）。
 * Run: node scripts/verify-svc.mjs (server :3000, preview :4173)
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
const uniq = Date.now().toString(36).slice(-4);

const json = (obj) => JSON.stringify(obj);
const mock = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = req.url ?? "";
  if (url.startsWith("/version")) return res.end(json("v1.18.8"));
  if (url.startsWith("/proxies")) return res.end(json({ proxies: { a: {}, b: {} } }));
  if (url.startsWith("/memory")) return res.end(json({ inuse: 67108864 }));
  if (url.startsWith("/api/system/status")) return res.end(json({ Version: "2.21.4" }));
  if (url.startsWith("/api/endpoints/1/docker")) return res.end(json([{ State: "running" }, { State: "exited" }]));
  if (url.startsWith("/api/endpoints")) return res.end(json([{ Id: 1 }, { Id: 2 }]));
  if (url.startsWith("/rest/ping")) return res.end(json({ "subsonic-response": { status: "ok", version: "0.53.3" } }));
  if (url.startsWith("/rest/getStats")) return res.end(json({ "subsonic-response": { songs: 100, albums: 10, artists: 5 } }));
  if (url.startsWith("/api/server/ping")) return res.end(json({ res: "pong" }));
  if (url.startsWith("/api/server-info/version")) return res.end(json({ version: "1.95.2" }));
  if (url.startsWith("/api/statistics")) return res.end(json({ photos: 12, videos: 3 }));
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${mock.address().port}`;

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
      const btn = ex ? btns.find((b) => b.textContent.trim() === l) : btns.find((b) => b.textContent.trim().includes(l));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { l: label, ex: exact },
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
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.offsetParent !== null && e.textContent.includes(o));
    opt?.click();
    return Boolean(opt);
  }, optionText);
};

const addOverview = async (sourceName) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  // 卡片 = name+category+desc 的 UnstyledButton —— 按 name 前缀定位（精确文本会失配）
  const picked = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".wb-picker-card")].find((c) => c.textContent.trim().startsWith("服务概览"));
    card?.click();
    return Boolean(card);
  });
  if (!picked) return false;
  await sleep(400);
  if (!(await selectOption("数据连接", sourceName))) return false;
  await sleep(200);
  return clickBtn("确认添加", true);
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
  await sleep(400);

  // 前置：四类服务连接 + 一个坏连接（API 播种）
  const seeded = await page.evaluate(
    async ({ base, uniq }) => {
      const mk = (kind, name, config) =>
        fetch("/api/data-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, name, config }),
        }).then((r) => r.ok);
      return {
        mihomo: await mk("mihomo", `svc-mihomo-${uniq}`, { url: base }),
        portainer: await mk("portainer", `svc-portainer-${uniq}`, { url: base }),
        navidrome: await mk("navidrome", `svc-navidrome-${uniq}`, { url: base, username: "u", password: { credentialRef: "cred:none" } }),
        immich: await mk("immich", `svc-immich-${uniq}`, { url: base }),
        broken: await mk("mihomo", `svc-broken-${uniq}`, { url: "http://127.0.0.1:1" }),
      };
    },
    { base, uniq },
  );
  ok("SVC seed service connections", Object.values(seeded).every(Boolean), JSON.stringify(seeded));

  // ①② mihomo 概览
  ok("SVC enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("SVC add mihomo overview", await addOverview(`svc-mihomo-${uniq}`));
  await sleep(2500);
  let body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC mihomo version + stats", body.includes("v1.18.8") && body.includes("代理") && body.includes("内存"), body.slice(-140));

  // portainer / navidrome / immich
  ok("SVC add portainer overview", await addOverview(`svc-portainer-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC portainer stats", body.includes("2.21.4") && body.includes("端点") && body.includes("2/2 运行中".replace("2/2", "1/2")), body.slice(-140));

  ok("SVC add navidrome overview", await addOverview(`svc-navidrome-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC navidrome stats", body.includes("0.53.3") && body.includes("歌曲") && body.includes("100"), body.slice(-140));

  ok("SVC add immich overview", await addOverview(`svc-immich-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC immich stats", body.includes("1.95.2") && body.includes("照片") && body.includes("12"), body.slice(-140));

  // ④ 坏连接显式失败
  ok("SVC add broken overview", await addOverview(`svc-broken-${uniq}`));
  await sleep(2500);
  body = await page.evaluate(() => document.body.textContent ?? "");
  ok("SVC broken source surfaced", body.includes("探测失败") && body.includes("无法读取服务"), body.slice(-140));
  ok("SVC exit edit", await clickBtn("完成编辑"));
  await sleep(400);

  // ③ 官方品牌图标（数据连接画廊 —— 服务用官方图标不自绘；Q38a/Q39）
  await clickBtn("数据源管理");
  await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "数据连接")?.click());
  await sleep(400);
  const galleryIcons = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".wb-source-card")];
    return {
      total: cards.length,
      iconed: cards.filter((c) => c.querySelector(".wb-service-icon svg, img.wb-service-icon")).length,
    };
  });
  ok("SVC gallery shows official brand icons (Q39)", galleryIcons.total >= 7 && galleryIcons.iconed >= 6, JSON.stringify(galleryIcons));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
mock.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
