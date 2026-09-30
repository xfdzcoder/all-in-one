/**
 * P8 验收（FR-P8 编辑/浏览分离 · 编辑态组件内容惰性，用户反馈②）：
 *  ① 浏览模式：卡片可正常操作（勾选任务生效）；
 *  ② 编辑模式：组件内容整体 inert —— 勾选/输入均不生效（拖动=调整布局）；
 *  ③ 编辑模式：「配置」入口不受影响（宿主能力）；
 *  ④ 回到浏览模式：操作恢复。
 * Run: node scripts/verify-p8.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-4);
const taskTitle = `p8-task-${uniq}`;

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

/** 真实鼠标点击指定任务行的勾选框（命中测试才走 inert 语义）。 */
const toggleTask = async (title) => {
  const box = await page.evaluateHandle((t) => {
    const leaf = [...document.querySelectorAll(".grid-stack-item *")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").includes(t),
    );
    if (!leaf) return null;
    let row = leaf.parentElement;
    while (row && !row.querySelector(".mantine-Checkbox-root")) row = row.parentElement;
    return row?.querySelector(".mantine-Checkbox-root") ?? null;
  }, title);
  const el = box.asElement();
  if (!el) return "no-checkbox";
  // 列表内可能有大量历史任务：先滚入视口再取坐标（否则点击落在视口外）
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await sleep(200);
  const rect = await el.boundingBox();
  if (!rect) return "no-box";
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return "clicked";
};

const taskChecked = (title) =>
  page.evaluate((t) => {
    const leaf = [...document.querySelectorAll(".grid-stack-item *")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").includes(t),
    );
    if (!leaf) return "no-task";
    let row = leaf.parentElement;
    while (row && !row.querySelector('input[type="checkbox"]')) row = row.parentElement;
    return String(row?.querySelector('input[type="checkbox"]')?.checked ?? "no-checkbox");
  }, title);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 前置：重置首页布局（含 Todo 组件）+ 建一条任务
  await page.evaluate(async (task) => {
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
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: task, list: "inbox" }),
    });
  }, taskTitle);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(1000);

  // ① 浏览模式：勾选生效
  const afterBrowseClick = await toggleTask(taskTitle);
  await sleep(600);
  const browseChecked = await taskChecked(taskTitle);
  ok("P8 browse mode: checkbox toggles", afterBrowseClick === "clicked" && browseChecked === "true", `${afterBrowseClick} checked=${browseChecked}`);

  // ② 编辑模式：内容惰性 —— 勾选不生效
  ok("P8 enter edit", await clickBtn("编辑页面"));
  await sleep(400);
  const afterEditClick = await toggleTask(taskTitle);
  await sleep(600);
  const editChecked = await taskChecked(taskTitle);
  ok(
    "P8 edit mode: checkbox inert",
    afterEditClick === "clicked" && editChecked === "true",
    `${afterEditClick} checked=${editChecked}`,
  );

  // ② 编辑模式：输入不生效
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === "新任务…");
    input?.focus();
    input?.click();
  });
  await page.keyboard.type("should-not-appear");
  await sleep(300);
  const draftValue = await page.evaluate(
    () => [...document.querySelectorAll("input")].find((i) => i.placeholder === "新任务…")?.value ?? "MISSING",
  );
  ok("P8 edit mode: inputs inert", draftValue === "", String(draftValue));

  // ③ 编辑模式：「配置」入口照常（宿主能力不受惰性影响）
  ok(
    "P8 edit mode: 配置 entry works",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) =>
        (i.textContent ?? "").includes("Todo ·"),
      );
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
      if (!btn) return false;
      btn.click();
      return true;
    }),
  );
  await sleep(500);
  const modalOpen = await page.evaluate(() => (document.body.textContent ?? "").includes("保存配置"));
  ok("P8 config form opens from edit mode", modalOpen);
  await page.keyboard.press("Escape");
  await sleep(400);

  // ④ 回到浏览模式：操作恢复
  ok("P8 exit edit", await clickBtn("完成编辑"));
  await sleep(400);
  const afterRestore = await toggleTask(taskTitle);
  await sleep(600);
  const restoreChecked = await taskChecked(taskTitle);
  ok("P8 browse restored: checkbox toggles again", afterRestore === "clicked" && restoreChecked === "false", `${afterRestore} checked=${restoreChecked}`);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
