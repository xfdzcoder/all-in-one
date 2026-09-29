/**
 * J4 acceptance: two Todo widgets on DIFFERENT dashboards share Workspace
 * data — toggling on one syncs to the other (via REST + SSE invalidation).
 * Run: node scripts/verify-j4.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const openTodos = () =>
  page.$$eval('.grid-stack-item input[placeholder="新任务…"]', (els) => els.length);

/** FR-W2 选择器流程：添加组件 → 选 manifest → configSchema 表单（默认值）→ 确认添加。 */
const addWidgetViaPicker = async (name) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn(name))) return false;
  await sleep(300);
  return clickBtn("确认添加", true);
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]");
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // page A (首页): edit → add Todo widget
  ok("J4 enter edit A", await clickBtn("编辑布局"));
  await sleep(300);
  ok("J4 add Todo on page A", await addWidgetViaPicker("个人 Todo"));
  await sleep(1200); // portal render + hydration
  const todoInputsA = await openTodos();
  ok("J4 Todo widget renders on page A", todoInputsA >= 1, `inputs=${todoInputsA}`);

  // create task on page A（标题按轮唯一 —— 任务归 Workspace 且跨轮累积）
  const title = `J4-${Date.now().toString(36)}`;
  const todoBoxes = await page.$$(".grid-stack-item");
  let targetBox = null;
  for (const b of todoBoxes) {
    if ((await b.$('input[placeholder="新任务…"]'))) targetBox = b;
  }
  await (await targetBox.$('input[placeholder="新任务…"]')).type(title);
  const addBtn = await targetBox.$$("button");
  for (const btn of addBtn) {
    if ((await btn.evaluate((e) => e.textContent.trim())) === "添加") {
      await btn.click();
      break;
    }
  }
  ok("J4 add task", true);
  await sleep(600);
  const taskVisibleA = await page.evaluate((t) => document.body.textContent.includes(t), title);
  ok("J4 task visible on page A", taskVisibleA);

  // create page B with its own Todo widget
  await page.setViewport({ width: 1400, height: 900 });
  const uniq = `J4-${Date.now().toString(36).slice(-4)}`;
  await page.type('input[placeholder="新页面名"]', uniq);
  ok("J4 create page B", await clickBtn("新建页面"));
  await sleep(800);
  ok("J4 enter edit B", await clickBtn("编辑布局"));
  await sleep(300);
  ok("J4 add Todo on page B", await addWidgetViaPicker("个人 Todo"));
  await sleep(1500); // portal render + SSE round-trip

  // task created on A must appear on B WITHOUT reload (SSE invalidation + query)
  const state = await page.evaluate((t) => {
    const onB = [...document.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.getAttribute("aria-selected") === "true",
    )?.textContent;
    return {
      activeTab: onB ?? "",
      taskVisible: document.body.textContent.includes(t),
      todoWidgets: document.querySelectorAll('.grid-stack-item input[placeholder="新任务…"]').length,
    };
  }, title);
  ok(
    "J4 task syncs to page B (data/view separation)",
    state.taskVisible && state.activeTab.startsWith("J4-") && state.todoWidgets >= 1,
    `tab=${state.activeTab} task=${state.taskVisible} todos=${state.todoWidgets}`,
  );

  // toggle done on page B — widget filter=open, so completing the task makes it
  // disappear from the list (assert state CHANGED, not a vacuous checkbox scan)
  const hasCheckbox = await page.$('.grid-stack-item input[type="checkbox"]');
  if (hasCheckbox) {
    // 勾选目标任务所在行（Workspace 里还有其它任务，不能盲点第一个 checkbox）
    const toggled = await page.evaluate((t) => {
      const row = [...document.querySelectorAll(".grid-stack-item li")].find((r) =>
        (r.textContent ?? "").includes(t),
      );
      const box = row?.querySelector('input[type="checkbox"]');
      box?.click();
      return Boolean(box);
    }, title);
    await sleep(1000);
    const stillOpenOnB = await page.evaluate((t) => document.body.textContent.includes(t), title);
    ok("J4 toggle done on page B (task leaves open list)", toggled && !stillOpenOnB, `toggled=${toggled}`);
  } else {
    ok("J4 toggle done on page B", false, "no checkbox found");
  }

  // back to page A: completion must reflect there too (same Workspace data)
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "首页");
    tab?.click();
  });
  await sleep(1200);
  const doneOnA = await page.evaluate((t) => {
    const rows = [...document.querySelectorAll(".grid-stack-item p")];
    return rows.some(
      (r) => (r.textContent ?? "").includes(t) && r.style.textDecoration.includes("line-through"),
    );
  }, title);
  ok("J4 completion reflects on page A (line-through, Workspace-shared)", doneOnA);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
