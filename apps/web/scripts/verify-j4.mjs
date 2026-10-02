/**
 * J4 acceptance: two Todo widgets on DIFFERENT dashboards share Workspace
 * data — toggling on one syncs to the other (via REST + SSE invalidation).
 * Run: node scripts/verify-j4.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";
import { ADMIN_PASSWORD, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
/** Q27d#1：页面切换器弹层。 */
const openSwitcher = async () => {
  // 幂等：弹层已开则不再点（点击是开/关切换）
  await page.evaluate(() => {
    const open = [...document.querySelectorAll("[data-page-item]")].some((b) => b.offsetParent !== null);
    if (!open) document.querySelector('[aria-label="切换页面"]')?.click();
  });
  await sleep(300);
};
const _switchPage = async (title) => {
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
        : btns.find((b) => b.textContent.trim().includes(l));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { l: label, ex: exact },
  );

const openTodos = () =>
  page.$$eval('.grid-stack-item input[placeholder="新任务…"]', (els) => els.length);

/** FR-W2 选择器流程：添加组件 → 选 manifest → configSchema 表单（默认值）→ 确认添加。 */
const addWidgetViaPicker = async (name, fillLabel, fillValue) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn(name))) return false;
  await sleep(300);
  if (fillLabel) {
    // Q29b：名称为 creatable Select —— 点击展开 → 键入 → 点「＋ 新建」选项
    await page.evaluate((l) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      wrapper?.querySelector("input")?.focus();
    }, fillLabel);
    await sleep(250);
    await page.keyboard.type(fillValue);
    await sleep(350);
    await page.evaluate((v) => {
      const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) =>
        e.textContent.includes(`新建「${v}」`),
      );
      opt?.click();
    }, fillValue);
    await sleep(250);
  }
  return clickBtn("确认添加", true);
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]");
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // ── J4（D43 语义）：任务归属 = 卡片名称；数据/视图分离 = 组件 ↔ 数据源管理同一数据 ──
  const uniqA = `A-${Date.now().toString(36).slice(-4)}`;
  ok("J4 enter edit A", await clickBtn("编辑页面"));
  await sleep(300);
  ok("J4 add Todo on page A", await addWidgetViaPicker("个人 Todo", "名称", `J4A-${uniqA}`));
  await sleep(1200);
  const todoInputsA = await openTodos();
  ok("J4 Todo widget renders on page A", todoInputsA >= 1, `inputs=${todoInputsA}`);
  ok("J4 exit edit A (browse to operate cards)", await clickBtn("完成编辑"));
  await sleep(400);

  // 组件建任务 → 归入卡片名称（scoped：只在 J4A 卡片内输入）
  const title = `J4-${Date.now().toString(36)}`;
  const typed = await page.evaluate(
    ({ n, t }) => {
      const box = [...document.querySelectorAll(".grid-stack-item")].find(
        (i) => (i.textContent ?? "").includes(n) && i.querySelector('input[placeholder="新任务…"]'),
      );
      const input = box?.querySelector('input[placeholder="新任务…"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, t);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      [...box.querySelectorAll("button")].find((b) => b.textContent.trim() === "添加")?.click();
      return true;
    },
    { n: `J4A-${uniqA}`, t: title },
  );
  ok("J4 add task in named card", typed);
  await sleep(800);
  ok("J4 task visible in card", await page.evaluate((t) => document.body.textContent.includes(t), title));

  // 数据/视图分离：同一数据在「数据源管理」按卡片名称分组可见
  ok("J4 open data admin", await clickBtn("数据源管理"));
  await sleep(600);
  // Q29b：任务页签 = 单 ToDo 视图（下拉切换）—— 选中目标 ToDo
  ok(
    "J4 data admin select ToDo",
    await page.evaluate((_n) => {
      const sel = document.querySelector('[aria-label="分组选择"]'); // WEB-22 术语统一（ToDo→分组）
      sel?.click();
      return Boolean(sel);
    }, `J4A-${uniqA}`),
  );
  await sleep(350);
  ok(
    "J4 data admin pick ToDo",
    await page.evaluate((n) => {
      const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.textContent.trim() === n);
      opt?.click();
      return Boolean(opt);
    }, `J4A-${uniqA}`),
  );
  await sleep(400);
  ok(
    "J4 data admin shows task under group (data/view separation)",
    await page.evaluate((t) => (document.body.textContent ?? "").includes(t), title),
  );

  // 数据源管理新建 → 组件无刷新即可见（SSE + 查询失效）
  const sseAdded = await page.evaluate(() => {
    const input = [...document.querySelectorAll(".wb-admin input")].find((i) =>
      i.placeholder.includes("新任务"),
    );
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "SSE-sync-task");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const btn = [...document.querySelectorAll(".wb-admin button")].find((b) => b.textContent.trim() === "添加");
    btn?.click();
    return Boolean(btn);
  });
  ok("J4 add task via data admin", sseAdded);
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("返回工作台"))?.click(),
  );
  await sleep(1200);
  ok(
    "J4 admin-created task syncs to widget (SSE, no reload)",
    await page.evaluate(() => document.body.textContent.includes("SSE-sync-task")),
  );

  // 页面 B：不同名称 = 不同任务池（D43 唯一名 → 隔离）
  await page.setViewport({ width: 1400, height: 900 });
  const uniq = `J4-${Date.now().toString(36).slice(-4)}`;
  await openSwitcher();
  await page.type('input[placeholder="新页面名"]', uniq);
  ok("J4 create page B", await clickBtn("新建页面"));
  await sleep(800);
  ok("J4 enter edit B", await clickBtn("编辑页面"));
  await sleep(300);
  ok("J4 add Todo on page B", await addWidgetViaPicker("个人 Todo", "名称", `J4B-${uniq}`));
  await sleep(1500);
  ok("J4 exit edit B (browse to operate cards)", await clickBtn("完成编辑"));
  await sleep(400);
  const isolated = await page.evaluate((t) => {
    const onB = document.querySelector('[aria-label="切换页面"]')?.textContent ?? "";
    return { activeTab: onB, taskVisible: document.body.textContent.includes(t) };
  }, title);
  ok(
    "J4 differently-named cards are isolated (D43 unique names)",
    isolated.activeTab.startsWith("J4-") && !isolated.taskVisible,
    `tab=${isolated.activeTab} task=${isolated.taskVisible}`,
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
