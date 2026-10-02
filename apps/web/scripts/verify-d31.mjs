/**
 * D31 一致性扫尾（Q17）：清单内单项删除同样走二次确认 ——
 *  ① Todo 任务「×」：取消保留 / 确认删除（弹窗点名任务）；
 *  ② 信息流源「×」退订：取消保留 / 确认退订（弹窗点名源）。
 * 唯一豁免原则（D34）：布局编辑内的组件移除（拖拽/删除最后）属常规编辑动作。
 * Run: node scripts/verify-d31.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-4);
const taskTitle = `d31-task-${uniq}`;
const sourceTitle = `d31-源-${uniq}`;

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

/** 点击某元素（按文本前缀找叶子节点）。 */
const clickLeaf = (text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll("body *")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").includes(t),
    );
    if (!el) return false;
    el.click();
    return true;
  }, text);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 前置：重置首页布局 + 建一条任务与一个源
  await page.evaluate(
    async ({ task, source }) => {
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
      await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: task, list: "inbox" }),
      });
      await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: source, url: "https://example.com/feed.xml" }),
      });
    },
    { task: taskTitle, source: sourceTitle },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(1200);

  // ① Todo 任务删除二次确认（scoped 到**该任务所在行**的「×」——列表里有历史任务）
  const openTaskConfirm = () =>
    page.evaluate((t) => {
      const leaf = [...document.querySelectorAll(".grid-stack-item *")].find(
        (n) => n.children.length === 0 && (n.textContent ?? "").includes(t),
      );
      if (!leaf) return false;
      // 向上找到包含「×」按钮的最小容器 = 该任务行
      let row = leaf.parentElement;
      while (row && ![...row.querySelectorAll("button")].some((b) => b.textContent.trim() === "×")) {
        row = row.parentElement;
      }
      const btn = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "×");
      if (!btn) return false;
      btn.click();
      return true;
    }, taskTitle);
  ok("D31 todo delete button found", await openTaskConfirm());
  await sleep(400);
  ok(
    "D31 todo dialog names the task",
    await page.evaluate((t) => (document.body.textContent ?? "").includes(`确认删除任务「${t}」`), taskTitle),
  );
  ok("D31 todo cancel keeps task", await clickBtn("取消", true));
  await sleep(600);
  ok("D31 task survives cancel", await page.evaluate((t) => (document.body.textContent ?? "").includes(t), taskTitle));
  ok("D31 todo delete reopen", await openTaskConfirm());
  await sleep(400);
  ok("D31 todo confirm deletes", await clickBtn("确认", true));
  await sleep(1000);
  ok("D31 task gone after confirm", await page.evaluate((t) => !(document.body.textContent ?? "").includes(t), taskTitle));

  // ② 信息流源退订二次确认（Q22b-2：退订入口移至「数据源管理 · 信息源」——点击按钮，非药丸）
  const openUnsub = async () => {
    await clickBtn("数据源管理"); // 幂等：已开时点击仍保持打开
    await sleep(400);
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find(
        (t) => t.textContent.trim() === "信息源",
      );
      tab?.click();
    });
    await sleep(300);
    return page.evaluate((t) => {
      // Q25c：数据源管理为全页视图 —— 行锚定 data-admin-row=feed（页面作用域）
      const row = [...document.querySelectorAll(".wb-admin [data-admin-row=feed]")].find((r) =>
        (r.textContent ?? "").includes(t),
      );
      const btn = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "退订");
      btn?.click();
      return Boolean(btn);
    }, sourceTitle);
  };
  ok("D31 rss unsubscribe opens confirm", await openUnsub());
  await sleep(400);
  ok(
    "D31 rss dialog names the source",
    await page.evaluate((t) => (document.body.textContent ?? "").includes(`确认退订「${t}」`), sourceTitle),
  );
  ok("D31 rss cancel keeps source", await clickBtn("取消", true));
  await sleep(600);
  ok("D31 source survives cancel", await page.evaluate((t) => (document.body.textContent ?? "").includes(t), sourceTitle));
  ok("D31 rss unsubscribe reopen", await openUnsub());
  await sleep(400);
  ok("D31 rss confirm unsubscribes", await clickBtn("确认", true));
  await sleep(1000);
  ok("D31 source gone after confirm", await page.evaluate((t) => !(document.body.textContent ?? "").includes(t), sourceTitle));

  // Q25c：退订旅程在数据源管理页 —— 先返回工作台再验 fixture
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("返回工作台"))?.click(),
  );
  await sleep(500);
  ok(
    "D31 首页 fixture untouched",
    await page.evaluate(() => (document.body.textContent ?? "").includes("欢迎")),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
