/**
 * M1 acceptance drive (J1/J2 + props round-trip + D10 mobile edit ban).
 * Run: node scripts/verify-m1.mjs  (server on :3000, web preview on :4173)
 */
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gs = (id, attr) =>
  page.$eval(`.grid-stack-item[gs-id="${id}"]`, (el, a) => el.getAttribute(a), attr);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();

/** Q27d#1：页面切换 = 右上角弹出下拉（页面管理在弹层内）。 */
const openSwitcher = async () => {
  // 幂等：弹层已开则不再点（点击是开/关切换）
  await page.evaluate(() => {
    const open = [...document.querySelectorAll("[data-page-item]")].some((b) => b.offsetParent !== null);
    if (!open) document.querySelector('[aria-label="切换页面"]')?.click();
  });
  await sleep(300);
};
const switchPage = async (title) => {
  await openSwitcher();
  return page.evaluate((t) => {
    const btn = [...document.querySelectorAll("[data-page-item]")].find(
      (b) => b.getAttribute("data-page-item") === t,
    );
    btn?.click();
    return Boolean(btn);
  }, title);
};

await page.setViewport({ width: 1400, height: 900 });

const clickBtn = (label, exact = false) =>
  page.evaluate(
    ({ l, ex }) => {
      const btns = [...document.querySelectorAll("button")];
      const btn = ex
        ? btns.find((b) => b.textContent.trim() === l)
        : btns.find((b) => b.textContent.includes(l));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { l: label, ex: exact },
  );

/** FR-W2 选择器流程：添加组件 → 选 manifest → configSchema 表单 → 确认添加。 */
const addWidgetViaPicker = async (name, fillTitle) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn(name))) return false;
  await sleep(300);
  if (fillTitle) {
    const okSet = await page.evaluate((t) => {
      const inputs = [...document.querySelectorAll(".mantine-Modal-root input")];
      const target = inputs.find((i) =>
        i.closest(".mantine-InputWrapper-root")?.querySelector("label")?.textContent.includes("标题"),
      );
      if (!target) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(target, t);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, fillTitle);
    if (!okSet) return false;
    await sleep(200);
  }
  return clickBtn("确认添加", true);
};

try {
  // J1: login screen renders
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]");
  ok("J1 login screen renders", true);

  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  // 显式选中「首页」（J1 默认页）——不依赖 tab 顺序
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("[data-page-item]")].find((t) => t.getAttribute("data-page-item") === "首页");
    tab?.click();
  });
  await sleep(400);
  ok("J1 login lands on default dashboard", true);

  const count = await page.$$eval(".grid-stack-item", (els) => els.length);
  ok("J1 default 首页 with example widgets", count >= 3, `${count} widgets`);

  // J2 前置：恢复默认 seed 布局（对齐 server seed）——历史布局会占用拖拽落点，
  // 重置后拖拽旅程可重复执行（gridstack 50% 碰撞规则，见 AGENTS.md）。
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
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE long-poll keeps network busy
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(400);

  // J2: drag INTO EMPTY SPACE below (no collision → gridstack >50% rule not applicable).
  // Asserting the position actually CHANGED (non-vacuous).
  ok("J2 enter edit mode", await clickBtn("编辑布局"));
  await sleep(300);
  const y0 = Number(await gs("seed-1", "gs-y"));
  const box = await (await page.$('.grid-stack-item[gs-id="seed-1"]')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + i * 55);
    await sleep(50);
  }
  await page.mouse.up();
  await sleep(400);
  const y1 = Number(await gs("seed-1", "gs-y"));
  ok("J2 drag moves widget (empty space below)", y1 > y0, `gs-y ${y0} -> ${y1}`);

  // J2: debounce auto-save (800ms) then reload restores the MOVED position
  await sleep(1500);
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE long-poll keeps network busy
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(400);
  const y2 = Number(await gs("seed-1", "gs-y"));
  ok("J2 auto-save + reload restores moved position", y1 === y2 && y2 > y0, `moved=${y1} restored=${y2}`);

  // props round-trip: picker → configSchema 表单（标题）→ 添加 → save → reload → props survive
  ok("J2b re-enter edit mode", await clickBtn("编辑布局"));
  await sleep(300);
  const countBefore = await page.$$eval(".grid-stack-item", (els) => els.length);
  const addedTitle = `N-${Date.now().toString(36).slice(-4)}`;
  ok("J2b add widget via picker form", await addWidgetViaPicker("占位组件", addedTitle));
  await sleep(1500); // debounce save
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE long-poll keeps network busy
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(400);
  const countAfter = await page.$$eval(".grid-stack-item", (els) => els.length);
  const titleAfter = await page.evaluate(
    (t) => [...document.querySelectorAll(".grid-stack-item strong")].some((e) => e.textContent === t),
    addedTitle,
  );
  ok(
    "J2b add widget persists after reload (props round-trip)",
    countAfter === countBefore + 1 && titleAfter,
    `count ${countBefore}->${countAfter}, title "${addedTitle}" visible=${titleAfter}`,
  );

  // D10/FR-P7: mobile shows no edit entry
  await page.setViewport({ width: 375, height: 720 });
  await sleep(600);
  const editVisible = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.includes("编辑布局")),
  );
  ok("D10 mobile hides edit entry", editVisible === false);

  // multi-page: create dashboard with unique name
  await page.setViewport({ width: 1400, height: 900 });
  await sleep(400);
  const uniq = `开发-${Date.now().toString(36).slice(-4)}`;
  await openSwitcher();
  await page.type('input[placeholder="新页面名"]', uniq);
  ok("multi-dashboard create", await clickBtn("新建页面"));
  await sleep(800);
  await openSwitcher();
  const tabs = await page.$$eval("[data-page-item]", (els) => els.map((e) => e.getAttribute("data-page-item")));
  ok("multi-dashboard tab appears", tabs.includes(uniq), JSON.stringify(tabs));

  // multi-dashboard: new page is empty (no seed), switch back to 首页 keeps widgets
  const countHome = await page.$$eval(".grid-stack-item", (els) => els.length);
  await switchPage("首页");
  await sleep(600);
  const countHome2 = await page.$$eval(".grid-stack-item", (els) => els.length);
  ok("multi-dashboard switch keeps widgets", countHome2 >= countBefore, `new page=${countHome} home=${countHome2}`);

  // D31：破坏性操作二次确认 —— 删除此页（误触不丢布局）
  const delName = `删除-${Date.now().toString(36).slice(-4)}`;
  await openSwitcher();
  await page.type('input[placeholder="新页面名"]', delName);
  ok("D31 create page for delete", await clickBtn("新建页面"));
  await sleep(800);
  await openSwitcher();
  ok("D31 open delete confirm", await clickBtn("删除此页"));
  await sleep(400);
  ok(
    "D31 confirm dialog explains data boundary",
    await page.evaluate(() => (document.body.textContent ?? "").includes("业务数据")),
  );
  ok("D31 cancel keeps page", await clickBtn("取消", true));
  await sleep(600);
  ok(
    "D31 page survives cancel",
    await page.evaluate((n) => [...document.querySelectorAll("[data-page-item]")].some((t) => t.getAttribute("data-page-item") === n), delName),
  );
  await openSwitcher();
  ok("D31 reopen delete confirm", await clickBtn("删除此页"));
  await sleep(400);
  ok("D31 confirm delete", await clickBtn("确认", true));
  await sleep(1000);
  ok(
    "D31 page deleted after confirm",
    await page.evaluate((n) => ![...document.querySelectorAll("[data-page-item]")].some((t) => t.getAttribute("data-page-item") === n), delName),
  );

  // FR-P1/P9：页面设置（名称/图标/背景）+ 排序（在临时页上验证，不动首页 fixture）
  const p1 = `P1-${Date.now().toString(36).slice(-4)}`;
  const renamed = `改名-${Date.now().toString(36).slice(-4)}`;
  await openSwitcher();
  await page.type('input[placeholder="新页面名"]', p1);
  ok("P1 create page", await clickBtn("新建页面"));
  await sleep(800);
  await openSwitcher();
  ok("P1 open page settings", await clickBtn("页面设置"));
  await sleep(400);
  ok(
    "P1 fill new name",
    await page.evaluate((t) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes("页面名称"),
      );
      const input = wrapper?.querySelector("input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, t);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, renamed),
  );
  ok("P1 save settings", await clickBtn("保存", true));
  await sleep(1000);
  await openSwitcher();
  ok(
    "P1 tab renamed",
    await page.evaluate((t) => [...document.querySelectorAll("[data-page-item]")].some((x) => (x.getAttribute("data-page-item") ?? "").includes(t)), renamed),
  );

  const orderBefore = await page.evaluate(() =>
    [...document.querySelectorAll("[data-page-item]")].map((t) => t.getAttribute("data-page-item")),
  );
  await openSwitcher();
  ok("P1 move up", await clickBtn("上移"));
  await sleep(1200);
  const orderAfter = await page.evaluate(() =>
    [...document.querySelectorAll("[data-page-item]")].map((t) => t.getAttribute("data-page-item")),
  );
  ok("P1 order changed", JSON.stringify(orderBefore) !== JSON.stringify(orderAfter), JSON.stringify(orderAfter));
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE long-poll keeps network busy
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(600);
  await openSwitcher();
  const orderReload = await page.evaluate(() =>
    [...document.querySelectorAll("[data-page-item]")].map((t) => t.getAttribute("data-page-item")),
  );
  ok(
    "P1 rename + order persist after reload",
    JSON.stringify(orderReload) === JSON.stringify(orderAfter),
    JSON.stringify(orderReload),
  );

  // FR-P9：图标 + 背景色（页面级设置）——刷新后活动页回到第一个，先选中目标 tab！
  await openSwitcher();
  ok(
    "P9 select renamed tab",
    await page.evaluate((t) => {
      const tab = [...document.querySelectorAll("[data-page-item]")].find((x) => (x.getAttribute("data-page-item") ?? "").includes(t));
      if (!tab) return false;
      tab.click();
      return true;
    }, renamed),
  );
  await sleep(600);
  await openSwitcher();
  ok("P9 open page settings", await clickBtn("页面设置"));
  await sleep(400);
  ok(
    "P9 fill icon",
    await page.evaluate(() => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes("图标"),
      );
      const input = wrapper?.querySelector("input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "🧪");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }),
  );
  ok(
    "P9 fill background",
    await page.evaluate(() => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes("背景色"),
      );
      const input = wrapper?.querySelector("input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "#102030");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }),
  );
  ok("P9 save settings", await clickBtn("保存", true));
  await sleep(1000);
  ok(
    "P9 icon shown on tab",
    await (async () => {
      await openSwitcher();
      return page.evaluate((t) => [...document.querySelectorAll("[data-page-item]")].some((x) => (x.textContent ?? "").includes(`🧪 ${t}`)), renamed);
    })(),
  );
  const bgApplied = await page.evaluate(() => {
    const main = document.querySelector(".mantine-AppShell-main");
    return main ? getComputedStyle(main).backgroundColor : null;
  });
  ok("P9 background applied", bgApplied === "rgb(16, 32, 48)", String(bgApplied));
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE long-poll keeps network busy
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(600);
  ok(
    "P9 settings persist after reload",
    await (async () => {
      await openSwitcher();
      return page.evaluate((t) => [...document.querySelectorAll("[data-page-item]")].some((x) => (x.textContent ?? "").includes(`🧪 ${t}`)), renamed);
    })(),
  );

  // 清理临时页：先选中目标 tab（刷新后活动页会回到第一个！），并核对确认弹窗点名的是它
  await openSwitcher();
  ok(
    "P1 select renamed tab before cleanup",
    await page.evaluate((t) => {
      const tab = [...document.querySelectorAll("[data-page-item]")].find((x) => (x.getAttribute("data-page-item") ?? "").includes(t));
      if (!tab) return false;
      tab.click();
      return true;
    }, renamed),
  );
  await sleep(600);
  await openSwitcher();
  ok("P1 cleanup open confirm", await clickBtn("删除此页"));
  await sleep(400);
  ok(
    "P1 confirm dialog names the target page",
    await page.evaluate((t) => (document.body.textContent ?? "").includes(`确认删除页面「${t}」`), renamed),
  );
  ok("P1 cleanup confirm", await clickBtn("确认", true));
  await sleep(800);
  await openSwitcher();
  ok(
    "P1 cleanup done",
    await page.evaluate((t) => ![...document.querySelectorAll("[data-page-item]")].some((x) => (x.getAttribute("data-page-item") ?? "").includes(t)), renamed),
  );
  ok(
    "P1 首页 fixture untouched",
    await (async () => {
      await openSwitcher();
      return page.evaluate(() => [...document.querySelectorAll("[data-page-item]")].some((x) => (x.textContent ?? "").includes("首页")));
    })(),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
