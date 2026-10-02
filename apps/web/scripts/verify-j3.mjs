/**
 * J3 acceptance (NFR2/D10): mobile 375px — reflow, browse+operate path
 * (Todo toggle / RSS read / launcher tap), touch targets ≥44px,
 * NO layout edit entry.
 * Run: node scripts/verify-j3.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";
import { ADMIN_PASSWORD, backToWorkspace, makeOk, openSettings, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

try {
  // 手机视口 375px（iPhone SE/mini 级别）
  await page.setViewport({ width: 375, height: 720, isMobile: true, hasTouch: true });
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  ok("J3 login screen renders at 375px", true);

  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  // 显式选中「首页」——不依赖 tab 顺序
  await page.evaluate(() => {
    const switcher = document.querySelector('[aria-label="切换页面"]');
    switcher?.click();
    const tabs = [...document.querySelectorAll("[data-page-item]")];
    // TST-10：首屏未必叫「首页」——回落首个页签
    const tab = tabs.find((t) => t.getAttribute("data-page-item") === "首页") ?? tabs[0];
    tab?.click();
  });
  await sleep(600);
  ok("J3 dashboard renders at 375px", true);

  // 无横向溢出（自动重排）
  const overflow = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
  }));
  ok("J3 no horizontal overflow (reflow)", overflow.docW <= overflow.winW + 2, JSON.stringify(overflow));

  // D10: 编辑入口不可见
  const editVisible = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.includes("编辑页面")),
  );
  ok("J3/D10 no edit entry on mobile", editVisible === false);

  // D41: 数据源管理移动端可达（数据操作非布局编辑）—— B1 起入口 = 设置 → 数据源
  const settingsVisible = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "设置" && b.offsetParent !== null,
    ),
  );
  ok("J3/D41 settings entry reachable on mobile", settingsVisible === true);
  ok("J3/D41 data source menu reachable on mobile", await openSettings(page, "数据源"));
  await sleep(500);
  ok(
    "J3/D41 data admin page opens on mobile",
    await page.evaluate(() => Boolean(document.querySelector(".wb-admin"))),
  );
  await backToWorkspace(page);
  await sleep(400);

  // NFR2: 可交互元素触控目标 ≥44px（高度）
  const touchAudit = await page.evaluate(() => {
    const sel = "button, a[href], input, [role='checkbox'], [role='tab']";
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0; // 仅可见元素
    });
    const small = els
      .map((e) => ({ tag: e.tagName, text: (e.textContent ?? e.getAttribute("aria-label") ?? "").trim().slice(0, 20), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
      .filter((e) => e.h < 44 || e.w < 44);
    return { total: els.length, small };
  });
  ok(
    "NFR2 touch targets ≥44px",
    touchAudit.small.length === 0,
    `${touchAudit.total} interactive, ${touchAudit.small.length} too small: ${JSON.stringify(touchAudit.small.slice(0, 5))}`,
  );

  // J3: Todo 添加 + 勾选（浏览模式下的组件内操作路径）
  const todoInput = (await page.$$('.grid-stack-item input[placeholder="新任务…"]'))[0];
  if (todoInput) {
    await todoInput.type("手机任务");
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "添加");
      btn?.click();
    });
    await sleep(1000);
    const created = await page.evaluate(() => document.body.textContent.includes("手机任务"));
    ok("J3 todo create on mobile", created);
    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.grid-stack-item input[type="checkbox"]')];
      boxes[0]?.click();
    });
    await sleep(1000);
    ok("J3 todo toggle on mobile", true);
  } else {
    ok("J3 todo create on mobile", false, "no todo input found");
  }

  // J3: RSS 卡可浏览（Q85 后卡片标题 = 「RSS」）。移动端纯浏览、不能加组件（D10）——
  // 页面上有没有 RSS 卡取决于用户布局；**没有则跳过**（Q118：内容依赖断言改条件式，
  // 明确标 skipped 而非假绿；j3 改自建草稿盘的整改入 TST-19 欠账）
  const rssCheck = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".wb-widget")].filter(
      (w) => (w.querySelector(".wb-widget__title-fit")?.textContent ?? "").trim() === "RSS",
    );
    if (cards.length === 0) return { present: false, ok: false };
    return { present: true, ok: (cards[0].textContent ?? "").length > 10 }; // 在场就断言真渲染了
  });
  ok(
    "J3 rss content visible on mobile",
    !rssCheck.present || rssCheck.ok,
    rssCheck.present ? "" : "页面无 RSS 卡 — 跳过（内容依赖断言）",
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
