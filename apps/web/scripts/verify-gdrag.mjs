/**
 * verify-gdrag —— Q43 拖动卡片偶发消失压测复现（gridstack 布局拖拽）：
 *  反复拖动卡片走多路径（空白落点 / 碰撞交换 / 越出网格上缘经工具栏 / 越出下缘），
 *  每次松手后断言：所有 .grid-stack-item 的 .grid-stack-item-content 内仍有 portal 内容
 *  （消失症状 = 外壳与缩放手柄还在，内容被卸载）。
 * Run: node scripts/verify-gdrag.mjs (server :3001, preview :4173)
 */
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${label}  ${extra}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

/** 每个 item 的内容健康度：item 数 / 有内容数 / 空壳列表（gs-id）。 */
const contentHealth = () =>
  page.evaluate(() => {
    const items = [...document.querySelectorAll(".grid-stack-item")].filter(
      (i) => !i.classList.contains("grid-stack-placeholder"),
    );
    const empty = [];
    for (const it of items) {
      const c = it.querySelector(":scope > .grid-stack-item-content");
      if (!c || c.childElementCount === 0) empty.push(it.getAttribute("gs-id") ?? "?");
    }
    return { total: items.length, empty };
  });

const dragBy = async (gsId, dx, dy, { crossTop = false, steps = 12, returnHome = false } = {}) => {
  const box = await page.evaluate((id) => {
    const el = [...document.querySelectorAll(".grid-stack-item")].find((e) => e.getAttribute("gs-id") === id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, gsId);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    let y = box.y + dy * t;
    if (crossTop) y = y - 120 * Math.sin(Math.PI * t); // 中途抬出网格上缘（经工具栏区）
    await page.mouse.move(box.x + dx * t, y);
    await sleep(30);
  }
  if (returnHome) {
    // 拖远后原路放回原位：松手时位置不变 → 无 change 事件 → 无法自愈
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      await page.mouse.move(box.x + dx * t, box.y + dy * t);
      await sleep(30);
    }
  }
  await page.mouse.up();
  await sleep(400);
  return true;
};

try {
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle0" });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 前置：首页 5 卡布局（错落尺寸，制造碰撞与空白落点）
  await page.evaluate(async () => {
    const seed = [
      { id: "g1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "甲", color: "#4a6fa5" } },
      { id: "g2", x: 4, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "乙", color: "#6a4fa5" } },
      { id: "g3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "丙", color: "#4fa56a" } },
      { id: "g4", x: 0, y: 3, w: 6, h: 3, component: "StatBox", props: { label: "丁", value: "OK" } },
      { id: "g5", x: 6, y: 3, w: 6, h: 3, component: "Placeholder", props: { title: "戊", color: "#a56a4f" } },
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
  await sleep(800);

  ok(
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().includes("编辑页面"));
      b?.click();
      return Boolean(b);
    }),
    "GDRAG enter edit",
  );
  await sleep(400);

  const baseline = await contentHealth();
  ok(baseline.total === 5 && baseline.empty.length === 0, "GDRAG baseline: all items have content", JSON.stringify(baseline));

  // 复现路径：拖到网格下缘外（_extraDragRow 撑高 → ResizeObserver → 拖动中事件 →
  // node.el 仍是 placeholder 时 portal 解绑），再原路放回（松手无 change 事件 → 不自愈）
  await dragBy("g5", 0, 420, { returnHome: true, steps: 16 });
  const h1 = await contentHealth();
  ok(h1.total === 5 && h1.empty.length === 0, "GDRAG drop-back-at-origin: no vanished card", JSON.stringify(h1));

  // 24 轮混合压测
  for (let i = 1; i <= 24; i++) {
    const target = `g${((i - 1) % 5) + 1}`;
    const mode = i % 4;
    if (mode === 0) await dragBy(target, -520, 260, { crossTop: true });
    else if (mode === 1) await dragBy(target, 520, -240, { crossTop: true });
    else if (mode === 2) await dragBy(target, i % 2 ? 300 : -300, i % 3 ? 180 : -120);
    else await dragBy(target, 120, 320, { crossTop: true });
    const h = await contentHealth();
    ok(h.total === 5 && h.empty.length === 0, `GDRAG round ${i}: no vanished card`, JSON.stringify(h));
    if (h.empty.length) break;
  }
  // Q43 确定性回归：模拟竞态窗口（渲染期 findInGrid 短暂查不到节点）→
  // wrapper 重算不得卸载卡片内容（补丁前 syntheticItems 返回 null → portal 消失）
  const race = await page.evaluate(async () => {
    const grid = document.querySelector(".grid-stack").gridstack;
    const Utils = grid.constructor.Utils;
    const orig = Utils.findInGrid;
    const counts = () =>
      [...document.querySelectorAll(".grid-stack-item")].map(
        (it) => it.querySelector(":scope > .grid-stack-item-content")?.childElementCount ?? 0,
      );
    Utils.findInGrid = () => undefined; // 竞态窗口：lookup 失败
    let during;
    try {
      grid.update(document.querySelector(".grid-stack-item"), {}); // updateCB → 重算
      await new Promise((r) => setTimeout(r, 300));
      during = counts();
    } finally {
      Utils.findInGrid = orig;
    }
    grid.update(document.querySelector(".grid-stack-item"), {}); // 恢复后再次重算
    await new Promise((r) => setTimeout(r, 300));
    return { during, after: counts() };
  });
  ok(
    race.during.every((n) => n > 0) && race.after.every((n) => n > 0),
    "Q43 race window: content survives transient lookup failure",
    JSON.stringify(race),
  );

  // 收尾：恢复标准首页 seed（todo + rss）——verify 脚本共享同一工作台，
  // 不恢复会污染依赖环境状态的后续脚本（verify-j3 不自播种）
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
} catch (e) {
  ok(false, "flow completed", String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
