/**
 * 设计审计采集（Q19a）：每一个页面 / 每一个组件的截图基线。
 * 数据通道与业务 API 全部用请求拦截夹具喂真实形状的数据 —— 组件以"有内容"状态出镜；
 * 产出 docs/design-audit/baseline/*.png 供视觉诊断与改版前后对比。
 * Run: node scripts/capture-design.mjs (server :3000, preview :4173)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { ADMIN_PASSWORD, makeClickBtn } from "./lib/verify-kit.mjs";

import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";

const WEB = "http://localhost:4173/";
const OUT = process.env.DESIGN_OUT
  ? join(process.cwd(), "..", "..", "docs", "design-audit", process.env.DESIGN_OUT)
  : join(process.cwd(), "..", "..", "docs", "design-audit", "baseline");
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 夹具（形状对齐各 API）--------------------------------------------------
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
  errors: [{ title: "坏源", error: "ETIMEDOUT" }],
};

const launcherFixture = {
  items: [
    { name: "Portainer", url: "http://192.168.31.133:9000", alive: true },
    { name: "NAS", url: "http://192.168.31.10", alive: true },
    { name: "下载器", url: "http://192.168.31.20:8080", alive: false },
  ],
  up: 2,
  total: 3,
};

const monitorFixture = {
  probe: { ok: true, source: "glances", version: "4.9.0" },
  cpuName: "Intel N100",
  cores: 4,
  cpu: { percent: 23.5 },
  mem: { percent: 61.2, usedBytes: 5257150464, totalBytes: 8589934592 },
  load: { min1: 1.2, min5: 0.8, min15: 0.4 },
  uptime: "12 days, 4:05:06",
  disks: [
    { point: "/", percent: 77.4, usedBytes: 77400000000, totalBytes: 100000000000 },
    { point: "/backup", percent: 20.1, usedBytes: 40200000000, totalBytes: 200000000000 },
  ],
};

const customApiFixture = {
  title: "构建状态",
  cpu: 23.5,
  status: "ok",
  items: [
    { name: "api-gateway", value: "42ms" },
    { name: "worker", value: "118ms" },
  ],
};

const mailAccounts = [
  { id: "m1", name: "个人邮箱", kind: "imap", host: "imap.example.com", port: 993, security: "ssl", username: "me@example.com", credentialId: "c1", folder: "INBOX" },
  { id: "m2", name: "Gmail · me@gmail.com", kind: "gmail", host: "gmail", port: 0, security: "oauth2", username: "me@gmail.com", credentialId: "c2", folder: "INBOX" },
];
const mailMessages = {
  items: [
    { uid: "u1", subject: "服务器告警：磁盘使用率 92%", from: "alerts@example.com", date: "2026-09-30T07:12:00.000Z", seen: false, accountId: "m1", accountName: "个人邮箱" },
    { uid: "u2", subject: "每周备份报告", from: "backup@example.com", date: "2026-09-30T06:00:00.000Z", seen: true, accountId: "m1", accountName: "个人邮箱" },
    { uid: "u3", subject: "发票 2026-09", from: "billing@service.com", date: "2026-09-29T18:30:00.000Z", seen: false, accountId: "m2", accountName: "Gmail · me@gmail.com" },
  ],
  errors: [{ accountId: "m3", accountName: "工作邮箱", error: "IMAP 连接超时" }],
};

const kanbanBoards = [{ id: "kb-1", title: "家庭实验室" }];
const kanbanTree = {
  board: { id: "kb-1", title: "家庭实验室" },
  columns: [
    { id: "kc-1", boardId: "kb-1", title: "待办", sortOrder: 0 },
    { id: "kc-2", boardId: "kb-1", title: "进行中", sortOrder: 1 },
    { id: "kc-3", boardId: "kb-1", title: "完成", sortOrder: 2 },
  ],
  cards: [
    { id: "kd-1", boardId: "kb-1", columnId: "kc-1", title: "迁移照片库到新盘", body: "含缩略图重建", archived: false, sortOrder: 0 },
    { id: "kd-2", boardId: "kb-1", columnId: "kc-1", title: "配置 UPS 告警", body: "", archived: false, sortOrder: 1 },
    { id: "kd-3", boardId: "kb-1", columnId: "kc-2", title: "整理机柜走线", body: "标签打印完成", archived: false, sortOrder: 0 },
    { id: "kd-4", boardId: "kb-1", columnId: "kc-3", title: "部署监控打通", body: "", archived: false, sortOrder: 0 },
    { id: "kd-5", boardId: "kb-1", columnId: "kc-3", title: "旧任务归档", body: "", archived: true, sortOrder: 1 },
  ],
};

const jsxTemplate =
  "<Stack>" +
  "<Title>{data.title}</Title>" +
  '<Group><Badge color="green">{data.status}</Badge><Text size="sm">CPU {Math.round(data.cpu)}%</Text></Group>' +
  '<Progress value={data.cpu} label="CPU" />' +
  "<Text>依赖服务 {data.items.length} 个</Text>" +
  "</Stack>";

const LAYOUT = [
  { id: "w-todo", x: 0, y: 0, w: 4, h: 5, component: "todo", props: { list: "inbox", filter: "all", refreshSec: 60 } },
  { id: "w-rss", x: 4, y: 0, w: 4, h: 5, component: "rss", props: { limit: 10, filter: "all" } },
  { id: "w-ph", x: 8, y: 0, w: 2, h: 2, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
  { id: "w-stat", x: 10, y: 0, w: 2, h: 2, component: "StatBox", props: { label: "在线服务", value: "2/3" } },
  { id: "w-mon", x: 8, y: 2, w: 4, h: 3, component: "monitor", props: { url: "http://127.0.0.1:61208", authMode: "none" } },
  { id: "w-kanban", x: 0, y: 5, w: 7, h: 5, component: "kanban", props: { boardId: "kb-1" } },
  { id: "w-mail", x: 7, y: 5, w: 5, h: 5, component: "mail", props: { limit: 20 } },
  { id: "w-api", x: 0, y: 10, w: 4, h: 4, component: "custom-api", props: { url: "http://127.0.0.1:9/stats", display: "stat", labelField: "title", valueField: "cpu" } },
  { id: "w-jsx", x: 4, y: 10, w: 4, h: 4, component: "custom-api", props: { url: "http://127.0.0.1:9/stats", display: "jsx", templateJsx: jsxTemplate } },
  { id: "w-launcher", x: 0, y: 14, w: 6, h: 3, component: "app-launcher", props: { itemsJson: JSON.stringify(launcherFixture.items.map((i) => ({ name: i.name, url: i.url, probe: "http" }))) } },
  { id: "w-iframe", x: 6, y: 14, w: 6, h: 3, component: "iframe", props: { url: "http://127.0.0.1:39997/frame" } },
];

// ---- mock：iframe 内容页 ---------------------------------------------------
const frameServer = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end("<!doctype html><html><body style='font-family:system-ui;background:#101418;color:#dde3ea;padding:16px'><h2>Portainer</h2><p>嵌入的内网面板内容</p></body></html>");
});
await new Promise((r) => frameServer.listen(39997, "127.0.0.1", r));

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
const clickBtn = makeClickBtn(page); // TST-12/14：精确优先匹配（首个命中陷阱消解）

try {
  // 登录页
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await sleep(500);
  await shot("01-login");

  // 全部数据面夹具拦截（登录后启用）
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
      if (type === "app-launcher") return json({ data: launcherFixture });
      if (type === "monitor") return json({ data: monitorFixture });
      return json({ data: customApiFixture });
    }
    if (url.includes("/api/mail/accounts")) return json(mailAccounts);
    if (url.includes("/api/mail/messages")) return json(mailMessages);
    if (/\/api\/kanban\/boards\/[^/]+$/.test(url)) return json(kanbanTree);
    if (url.includes("/api/kanban/boards")) return json(kanbanBoards);
    if (url.includes("/api/plugins")) return json([]);
    if (url.includes("/api/dashboards")) {
      // 列表与布局 PUT 透传到真实服务（布局写入用真实 API 完成）
      return req.continue();
    }
    return req.continue();
  });

  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 写入审计布局（真实 API）
  await page.evaluate(async (layout) => {
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页") ?? list[0]; // 回落首屏：真机/历史库可能没有「首页」（Q82 同款，TST-10）
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(layout) }),
    });
  }, LAYOUT);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // 页面级：浏览态全页
  await shot("02-home-full");

  // 组件级（按 gs-id 精确锚定 —— DOM 顺序不可靠）
  const byId = {
    "10-widget-todo": "w-todo",
    "11-widget-rss": "w-rss",
    "12-widget-placeholder": "w-ph",
    "13-widget-statbox": "w-stat",
    "14-widget-monitor": "w-mon",
    "15-widget-kanban": "w-kanban",
    "16-widget-mail": "w-mail",
    "17-widget-customapi-stat": "w-api",
    "18-widget-customapi-jsx": "w-jsx",
    "20-widget-launcher": "w-launcher",
    "21-widget-iframe": "w-iframe",
  };
  for (const [name, gsId] of Object.entries(byId)) {
    const el = await page.$(`.grid-stack-item[gs-id="${gsId}"]`);
    if (el) {
      await el.screenshot({ path: join(OUT, `${name}.png`) });
      console.log("shot:", name, "(element)");
    } else {
      console.log("MISS:", name, gsId);
    }
  }

  // 弹层/模态
  await clickBtn("编辑页面");
  await sleep(500);
  await shot("03-edit-mode");
  await clickBtn("添加组件");
  await sleep(500);
  await shot("04-widget-picker");
  await page.keyboard.press("Escape");
  await sleep(400);

  // 配置弹窗（Todo 实例）
  await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes("Todo ·"));
    const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
    btn?.click();
  });
  await sleep(500);
  await shot("05-config-modal");
  await page.keyboard.press("Escape");
  await sleep(400);

  await clickBtn("页面设置");
  await sleep(500);
  await shot("06-page-settings");
  await page.keyboard.press("Escape");
  await sleep(400);

  await clickBtn("删除此页");
  await sleep(500);
  await shot("07-confirm-dialog");
  await clickBtn("取消", true);
  await sleep(400);

  await clickBtn("插件管理");
  await sleep(500);
  await shot("08-plugin-admin");
  await page.keyboard.press("Escape");
  await sleep(400);

  await clickBtn("完成编辑");
  await sleep(400);

  // FR-I4 详情弹窗（自定义 API）
  await page.evaluate(() => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) =>
      (i.textContent ?? "").includes("自定义 API"),
    );
    const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "详情");
    btn?.click();
  });
  await sleep(500);
  await shot("09-detail-modal");
  await page.keyboard.press("Escape");
  await sleep(400);

  // 移动端 375
  await page.setViewport({ width: 375, height: 780 });
  await sleep(600);
  await shot("22-mobile-home");
  await page.evaluate(() => window.scrollTo(0, 900));
  await sleep(400);
  await shot("23-mobile-scrolled");
} catch (e) {
  console.log("FLOW ERROR:", String(e).slice(0, 300));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
frameServer.close();
console.log("baseline captured ->", OUT);
