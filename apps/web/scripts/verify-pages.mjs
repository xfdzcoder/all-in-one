/**
 * verify-pages —— 横向多页面切换（Q119，用户需求 2026-10-03）真机验收：
 *  ① **横滑切页**（指针在无横滚容器处）：切页成功 + `?page=` 深链同步 + 换页动画类出现；
 *  ② **冲突规则**（用户拍板「按指针作用域」）：指针在**有横向滚动条的看板**上 → 滚它、不切页；
 *  ③ **滚动位置保持**：切走再切回 scrollTop 恢复；**跨刷新**（localStorage）reload 后仍恢复；
 *  ④ **首尾回弹**：第一页继续往回滑不切走（循环开关在 Q120）。
 * 全程在**自建临时草稿盘**上进行（TST-23：不碰用户页面）；冲突用例自建 6 列看板、用完删。
 * Run: node scripts/verify-pages.mjs（server :3000 + preview :4173）
 */
import puppeteer from "puppeteer-core";
import {
  ADMIN_PASSWORD,
  backToWorkspace,
  createScratchDashboard,
  login,
  openSettings,
  makeApiFetch,
  makeOk,
  sleep,
  summarize,
  waitFor,
} from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173";
const results = [];
const ok = makeOk(results);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1280,720"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const pageTitle = () =>
  page.evaluate(() => document.querySelector('[aria-label="返回工作台"]')?.textContent?.trim() ?? "");

/**
 * 在某元素中心横滑（指针位置决定冲突规则的作用域）。
 * 取**可视区内**的首个命中 —— 视口外的元素中心会让滚轮打到 <body>（不经过 React handler），
 * 这是本轮调试抓到的测试坑：占位布局从第 6 行起，首格中心常在折叠线下。
 */
const swipeOver = async (selector, deltaX) => {
  const box = await page.evaluate((sel) => {
    // 「空白处」= 不含横滚容器的卡（看板卡会被冲突规则吃掉横滑，那正是另一个用例要的）
    const els = [...document.querySelectorAll(sel)].filter((el) => !el.querySelector(".wb-kanban__board"));
    const visible = els.find((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 60 && r.top < window.innerHeight - 10 && r.width > 0 && r.height > 0;
    });
    const el = visible ?? els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const y = Math.min(Math.max(r.y + r.height / 2, 70), window.innerHeight - 20);
    return { x: r.x + r.width / 2, y };
  }, selector);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaX, deltaY: 0 });
  return true;
};

/** 明确的「下一次手势」：等过手势边界（300ms）再滑 —— 快速连发属于同一手势（Q121）。 */
const swipeFresh = async (selector, deltaX) => {
  await sleep(400);
  return swipeOver(selector, deltaX);
};

/** 一次手势的连发（应只切一页）：定位一次、快速滚 N 下。 */
const swipeBurst = async (selector, count, deltaX) => {
  const box = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((el) => !el.querySelector(".wb-kanban__board"));
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.bottom > 60 && r.top < window.innerHeight - 10 && r.width > 0 && r.height > 0;
    }) ?? els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: Math.min(Math.max(r.y + r.height / 2, 70), window.innerHeight - 20) };
  }, selector);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel({ deltaX, deltaY: 0 });
    await sleep(30); // 远小于手势边界 → 同一手势
  }
  return true;
};

const setScrollTop = (top) =>
  page.evaluate((t) => {
    const el = document.querySelector(".wb-main");
    if (el) el.scrollTop = t;
    return el ? el.scrollTop : -1;
  }, top);

const getScrollTop = () => page.evaluate(() => document.querySelector(".wb-main")?.scrollTop ?? -1);

const tallLayout = (extras = []) => [
  ...extras,
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `pg-ph-${i}`,
    x: (i % 2) * 6,
    y: 6 + Math.floor(i / 2) * 6,
    w: 6,
    h: 6,
    component: "Placeholder",
    props: { title: `页面占位 ${i + 1}`, color: "#4a6fa5" },
  })),
];

let dashA = null;
let dashB = null;
let dashC = null;
let boardId = null;
let firstPageTitle = "";

try {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await login(page);
  const apiFetch = makeApiFetch(page);

  // ── 前置：两个临时草稿盘（超高内容）+ 一个 6 列看板（横滚冲突用）──
  dashA = await createScratchDashboard(apiFetch);
  dashB = await createScratchDashboard(apiFetch);
  dashC = await createScratchDashboard(apiFetch);
  const board = JSON.parse(
    (await apiFetch("/api/kanban/boards", { method: "POST", body: JSON.stringify({ title: `tmp-verify-pages-board` }) })).body,
  );
  boardId = board.id;
  // 冲突用例要**确定性横滚**：看板列会被 flex 压到极窄（word-break: break-word），
  // 列少时 sw==cw 根本不构成「横向滚动条」（本轮实测踩坑）——用 40 列让总量必然溢出
  // （实测 40 列 → sw 1038 > cw 795，吃横滑）。列里再放一张长词卡防列宽归零。
  for (let i = 0; i < 40; i++) {
    const col = JSON.parse(
      (await apiFetch("/api/kanban/columns", { method: "POST", body: JSON.stringify({ boardId, title: `列${i + 1}` }) })).body,
    );
    if (i === 0) {
      await apiFetch("/api/kanban/cards", {
        method: "POST",
        body: JSON.stringify({ columnId: col.id, title: `card-${"x".repeat(40)}` }),
      });
    }
  }
  const putLayout = (dash, layout) =>
    apiFetch(`/api/dashboards/${dash.id}/layout`, {
      method: "PUT",
      body: JSON.stringify({ layoutJson: JSON.stringify(layout) }),
    });
  ok(
    "PAGES seed tall pages + kanban board",
    (await putLayout(dashA, tallLayout([{ id: "pg-kanban", x: 0, y: 0, w: 8, h: 5, component: "kanban", props: { boardId } }]))).status === 200 &&
      (await putLayout(dashB, tallLayout())).status === 200 &&
      (await putLayout(dashC, tallLayout())).status === 200,
  );

  // ── ① 横滑切页 + 深链 + 动画 ──
  await page.goto(`${WEB}/?page=${dashA.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 10000 });
  ok("PAGES lands on page A", (await pageTitle()) === dashA.title, await pageTitle());
  await setScrollTop(0);

  ok("PAGES swipe over plain area", await swipeOver(".grid-stack-item", 160));
  const animSeen = await waitFor(page, () => Boolean(document.querySelector(".wb-page-viewport[class*='anim-']")), undefined, {
    timeoutMs: 800,
    intervalMs: 40,
  });
  ok("PAGES page-switch animation classes appear (Q119)", animSeen);
  ok(
    "PAGES swipe forward switches to page B",
    await waitFor(page, (t) => (document.querySelector('[aria-label="返回工作台"]')?.textContent ?? "") === t, dashB.title, {
      timeoutMs: 3000,
    }),
    await pageTitle(),
  );
  ok(
    "PAGES deep link ?page= follows (Q119)",
    await page.evaluate((id) => new URL(location.href).searchParams.get("page") === id, dashB.id),
  );

  // ── Q121 回归：一次手势（连续多事件/惯性尾巴）只切一页 —— 修复「滚一次切两页」──
  await page.goto(`${WEB}/?page=${dashA.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 10000 });
  ok("PAGES gesture burst fired", await swipeBurst(".grid-stack-item", 3, 120));
  await sleep(800);
  ok(
    "PAGES one gesture burst switches exactly ONE page (Q121)",
    (await pageTitle()) === dashB.title,
    `landed=${await pageTitle()}（切到 C 就是又「一次切两页」了）`,
  );

  ok("PAGES swipe back", await swipeFresh(".grid-stack-item", -160));
  ok(
    "PAGES swipe backward returns to page A",
    await waitFor(page, (t) => (document.querySelector('[aria-label="返回工作台"]')?.textContent ?? "") === t, dashA.title, {
      timeoutMs: 3000,
    }),
    await pageTitle(),
  );

  // ── ② 冲突规则：指针在有横滚条的看板上 → 不切页 ──
  await setScrollTop(0);
  ok("PAGES swipe over horizontally-scrollable kanban", await swipeOver(".wb-kanban__board", 160));
  await sleep(800);
  ok(
    "PAGES horizontal scroller under pointer wins (不切页，用户拍板)",
    (await pageTitle()) === dashA.title,
    await pageTitle(),
  );

  // ── ③ 滚动位置保持（会话内 + 跨刷新）——先自检在 A 上，防级联错页测量
  ok("PAGES back on page A before scroll test", (await pageTitle()) === dashA.title, await pageTitle());
  const saved = await setScrollTop(900);
  ok("PAGES scroll position set on A", saved > 0, `scrollTop=${saved}`);
  ok("PAGES swipe to B", await swipeFresh(".grid-stack-item", 160));
  await waitFor(page, (t) => (document.querySelector('[aria-label="返回工作台"]')?.textContent ?? "") === t, dashB.title, { timeoutMs: 3000 });
  await setScrollTop(300);
  ok("PAGES swipe back to A", await swipeFresh(".grid-stack-item", -160));
  await waitFor(page, (t) => (document.querySelector('[aria-label="返回工作台"]')?.textContent ?? "") === t, dashA.title, { timeoutMs: 3000 });
  // 恢复是「布局就绪后重试」——用 waitFor 等到位（换页瞬间读值会早于恢复完成）
  ok(
    "PAGES scroll position restored on return",
    await waitFor(page, (t) => Math.abs((document.querySelector(".wb-main")?.scrollTop ?? -1) - t) <= 5, saved, { timeoutMs: 4000 }),
    `saved=${saved} now=${await getScrollTop()}`,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 10000 });
  ok(
    "PAGES scroll position survives reload (localStorage)",
    await waitFor(page, (t) => Math.abs((document.querySelector(".wb-main")?.scrollTop ?? -1) - t) <= 5, saved, { timeoutMs: 4000 }),
    `saved=${saved} now=${await getScrollTop()}`,
  );

  // ── ④ 首尾回弹 ──
  const list = JSON.parse((await apiFetch("/api/dashboards")).body);
  firstPageTitle = list[0].title;
  await page.goto(`${WEB}/?page=${list[0].id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 10000 });
  ok("PAGES lands on first page", (await pageTitle()) === firstPageTitle, await pageTitle());
  ok("PAGES swipe backward on first page", await swipeOver(".grid-stack-item", -160));
  await sleep(800);
  ok("PAGES first page bounces (no wrap yet, Q120 adds toggle)", (await pageTitle()) === firstPageTitle, await pageTitle());

  // ── ⑤ Q120：键盘 / 指示器 / 循环开关 ──
  await page.goto(`${WEB}/?page=${dashA.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 10000 });
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Alt");
  ok(
    "PAGES keyboard Alt+→ switches forward (Q120)",
    await waitFor(page, (t) => (document.querySelector('[aria-label="返回工作台"]')?.textContent ?? "") === t, dashB.title, { timeoutMs: 3000 }),
  );
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Alt");
  ok(
    "PAGES keyboard Alt+← switches back (Q120)",
    await waitFor(page, (t) => (document.querySelector('[aria-label="返回工作台"]')?.textContent ?? "") === t, dashA.title, { timeoutMs: 3000 }),
  );

  const dots = await page.evaluate(() => document.querySelectorAll(".wb-page-dots__dot").length);
  ok("PAGES page indicator rendered (Q120)", dots >= 2, `dots=${dots}`);
  ok(
    "PAGES active dot marks current page",
    await page.evaluate((t) => document.querySelector(".wb-page-dots__dot--active")?.getAttribute("aria-label")?.includes(t) ?? false, dashA.title),
  );
  ok("PAGES click a dot jumps to that page", await page.evaluate(() => {
    const dots = [...document.querySelectorAll(".wb-page-dots__dot")];
    dots[dots.length - 1]?.click();
    return dots.length >= 2;
  }));
  ok(
    "PAGES dot click switched to last page",
    await waitFor(page, () => document.querySelector(".wb-page-dots__dot--active") === document.querySelectorAll(".wb-page-dots__dot")[document.querySelectorAll(".wb-page-dots__dot").length - 1], undefined, { timeoutMs: 3000 }),
  );

  // 循环开关（设置 · 外观，真实 UI 路径）→ 到头继续滑 = 切到另一头
  ok("PAGES open appearance settings", await openSettings(page, "外观"));
  ok("PAGES toggle wrap switch", await page.evaluate(() => {
    const sw = [...document.querySelectorAll(".wb-settings__panel label")].find((l) => (l.textContent ?? "").includes("循环切换页面"))?.querySelector("input");
    sw?.click();
    return Boolean(sw);
  }));
  ok("PAGES back to workspace", await backToWorkspace(page));
  await page.goto(`${WEB}/?page=${dashC.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 10000 });
  ok("PAGES lands on last page", (await pageTitle()) === dashC.title, await pageTitle());
  ok("PAGES swipe forward past the end", await swipeOver(".grid-stack-item", 160));
  ok(
    "PAGES wrap-around enabled (Q120) — 到头切到另一头",
    await waitFor(page, (t) => (document.querySelector('[aria-label="返回工作台"]')?.textContent ?? "") === t, firstPageTitle, { timeoutMs: 3000 }),
    await pageTitle(),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

// 清理：草稿盘 + 临时看板（Node 侧，浏览器无关）
try {
  const loginRes = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
  });
  const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  for (const d of [dashA, dashB, dashC]) {
    if (d) await fetch(`${WEB}/api/dashboards/${d.id}`, { method: "DELETE", headers: { cookie } });
  }
  if (boardId) await fetch(`${WEB}/api/kanban/boards/${boardId}`, { method: "DELETE", headers: { cookie } });
  ok("PAGES scratch cleaned up", true);
} catch (e) {
  ok("PAGES scratch cleaned up", false, String(e).slice(0, 160));
}

await browser.close();
summarize(results);
process.exit(results.some((r) => !r.pass) ? 1 : 0);
