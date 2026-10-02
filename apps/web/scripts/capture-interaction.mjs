/**
 * 交互文档截图管线（Q23a+）：按 docs/interaction/ 的页面/组件/交互面锚点采集关键态截图。
 * 与 capture-design.mjs 同法：数据面用请求拦截夹具喂真实形状数据（组件以有内容状态出镜）。
 * 产出 docs/interaction/assets/*.png，命名 = 文档引用锚点，可重复运行覆盖。
 * Run: node scripts/capture-interaction.mjs (server :3000, preview :4173)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_PASSWORD, makeClickBtn, openSettings } from "./lib/verify-kit.mjs";

import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";

const WEB = "http://localhost:4173/";
const OUT = join(process.cwd(), "..", "..", "docs", "interaction", "assets");
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 夹具（形状对齐各 API；组件有内容出镜）--------------------------------
const todos = [
  { id: "t1", list: "inbox", title: "复盘本周设计走查", done: false, sortOrder: 0, createdAt: now - 86400000, updatedAt: now - 3600000 },
  { id: "t2", list: "inbox", title: "给看板加卡片拖拽", done: true, sortOrder: 1, createdAt: now - 72000000, updatedAt: now - 6000000 },
  { id: "t3", list: "work", title: "整理监控告警阈值", done: false, sortOrder: 2, createdAt: now - 36000000, updatedAt: now - 1800000 },
];

const rssFixture = {
  items: [
    { title: "自托管周刊：监控方案横评", link: "https://example.com/a", summary: "Glances、Netdata、Uptime Kuma 三者对比……", date: "2026-09-30T08:00:00.000Z", itemKey: "k1", sourceTitle: "自托管周刊", read: false },
    { title: "Mantine v9 深色主题实践", link: "https://example.com/b", summary: "深色界面层级用表面明度表达而非投影……", date: "2026-09-29T08:00:00.000Z", itemKey: "k2", sourceTitle: "前端周刊", read: false },
    { title: "家庭实验室的备份策略", link: "https://example.com/c", summary: "3-2-1 原则与快照校验……", date: "2026-09-28T08:00:00.000Z", itemKey: "k3", sourceTitle: "自托管周刊", read: true },
  ],
  unread: 2,
  sourceCount: 2,
  errors: [],
};

const monitorFixture = {
  probe: { ok: true, version: "4.9.0" },
  cpu: { total: 23.5 },
  mem: { percent: 61.2, used: 5271457792, total: 8589934592 },
  load: { min1: 1.2, min5: 0.8, min15: 0.4 },
  fs: [
    { mnt_point: "/", size: 99965362176, used: 72155450982, percent: 72.1 },
    { mnt_point: "/backup", size: 200000000000, used: 37400000000, percent: 18.7 },
  ],
  uptime: 1053906,
  info: { cpuName: "Intel N100" },
};

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("shot:", name);
};
const elShot = async (name, selector) => {
  const el = await page.$(selector);
  if (!el) return console.log("skip (no el):", name);
  await el.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("shot:", name);
};
const clickBtn = makeClickBtn(page); // TST-12/14：精确优先匹配（首个命中陷阱消解）

try {
  // ── 页面 01 · 登录页 ──
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await sleep(400);
  await shot("p01-login");
  await clickBtn("忘记口令？");
  await sleep(200);
  await shot("p02-login-hint");
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", "wrong-pass");
  await page.click("button[type=submit]");
  await sleep(600);
  await shot("p03-login-error");

  // 登录成功后启用数据夹具
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    const json = (obj) => req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });
    if (url.includes("/api/todos")) return json(todos);
    if (url.includes("/api/widgets/data")) {
      let type = "";
      try {
        type = JSON.parse(req.postData() ?? "{}").type ?? "";
      } catch {
        /* noop */
      }
      if (type === "rss") return json({ data: rssFixture });
      if (type === "monitor") return json({ data: monitorFixture });
      return json({ data: {} });
    }
    if (url.includes("/api/plugins")) return json([]);
    return req.continue();
  });
  // 清空错误态残留再登录（输入框保留上次值，直接 type 会拼接）
  await page.evaluate(() => {
    for (const i of document.querySelectorAll("input")) {
      const proto = window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(i, "");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 写入页面走查布局（真实 API）
  await page.evaluate(async () => {
    const seed = [
      { id: "w-todo", x: 0, y: 0, w: 4, h: 5, component: "todo", props: { list: "inbox", filter: "all", refreshSec: 60 } },
      { id: "w-rss", x: 4, y: 0, w: 4, h: 5, component: "rss", props: { limit: 10, filter: "all" } },
      { id: "w-mon", x: 8, y: 0, w: 4, h: 5, component: "monitor", props: {} },
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
  await sleep(1000);

  // ── 页面 02 · 工作台 ──
  await shot("p04-workspace-overview");
  await elShot("p05-workspace-header", "header");
  await elShot("p06-workspace-tabbar", ".wb-tabs");

  // 删除此页确认（破坏性按钮的关键态）
  await clickBtn("删除此页");
  await sleep(400);
  await shot("p07-confirm-delete-page");
  await clickBtn("取消", true);
  await sleep(300);

  // 页面设置弹窗
  await clickBtn("页面设置");
  await sleep(400);
  await shot("p08-page-settings");
  await clickBtn("取消", true);
  await sleep(300);

  // ── 页面 03 · 编辑态 ──
  await clickBtn("编辑页面");
  await sleep(600);
  await shot("p09-edit-mode");
  await elShot("p10-edit-toolbar", ".grid-stack > :nth-child(2)");
  // hover 显示缩放手柄（Q19a 教训：手柄 autohide）
  const item = await page.$(".grid-stack-item");
  if (item) {
    const box = await item.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(400);
    await shot("p11-edit-hover-handle");
  }
  await clickBtn("完成编辑");
  await sleep(400);

  // ── 交互面 · 数据源管理（三页签）──
  await openSettings(page, "数据源");
  await sleep(500);
  await shot("s-data-admin-todo");
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find(
      (t) => t.offsetParent !== null && t.textContent.trim() === "信息源",
    );
    tab?.click();
  });
  await sleep(300);
  await shot("s-data-admin-feeds");
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find(
      (t) => t.offsetParent !== null && t.textContent.trim() === "标签",
    );
    tab?.click();
  });
  await sleep(300);
  await shot("s-data-admin-tags");
  await page.evaluate(() => {
    const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter(
      (r) => r.offsetParent !== null && r.textContent.trim().length > 0,
    );
    roots[roots.length - 1]?.querySelector(".mantine-Modal-close")?.click();
  });
  await sleep(300);

  // ── 移动端视图（D10 只读差异）──
  await page.setViewport({ width: 375, height: 780 });
  await sleep(600);
  await shot("p12-mobile-browse");
  await page.setViewport({ width: 1400, height: 900 });
} catch (e) {
  console.log("capture failed:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
console.log("interaction shots ->", OUT);
