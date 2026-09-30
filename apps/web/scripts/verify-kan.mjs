/**
 * KAN acceptance (Q6b KanbanWidget): 多项目看板、列与卡片、卡片操作 ——
 *  ① 新建看板（组件内选择器，选择即写回组件配置并持久化）；
 *  ② 加列 / 加卡；③ 改卡（标题/描述）；④ 卡片移动到其它列；⑤ 归档；
 *  ⑥ 刷新后看板选择与数据保持（props 往返 + Workspace 数据）。
 * Run: node scripts/verify-kan.mjs (server :3000, preview :4173)
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
const cardA = `卡片甲-${uniq}`;
const cardB = `卡片乙-${uniq}`;
const cardC = `卡片丙-${uniq}`;

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

const setField = (label, value) =>
  page.evaluate(
    ({ l, v }) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      const target = wrapper?.querySelector("input, textarea");
      if (!target) return false;
      const proto =
        target.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(target, v);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { l: label, v: value },
  );

const selectOption = async (label, optionText) => {
  await page.evaluate((l) => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes(l),
    );
    wrapper?.querySelector("[role=combobox]")?.click();
  }, label);
  await sleep(300);
  return page.evaluate((o) => {
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.textContent.includes(o));
    opt?.click();
    return Boolean(opt);
  }, optionText);
};

/** 在第 index 个同名 placeholder 输入框里打字（配合 Enter 提交）。 */
const fillNth = async (placeholder, index, text) => {
  const found = await page.evaluate(
    ({ ph, idx }) => {
      const inputs = [...document.querySelectorAll("input")].filter((i) => i.placeholder === ph);
      const target = inputs[idx];
      if (!target) return false;
      target.focus();
      target.click();
      return true;
    },
    { ph: placeholder, idx: index },
  );
  if (!found) return false;
  await page.keyboard.type(text);
  return true;
};

/** 列内按钮点击（Q26c：ghost→composer 后按列定位）。 */
const clickInColumn = (col, label) =>
  page.evaluate(
    ({ c, l }) => {
      const colDiv = document.querySelector(`[data-col-title="${c}"]`);
      const btn = [...(colDiv?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes(l));
      btn?.click();
      return Boolean(btn);
    },
    { c: col, l: label },
  );

/** 顶层可见弹窗内的精确按钮（关闭态空 root 不计，Q4 教训）。 */
const clickInTopModal = (label) =>
  page.evaluate((l) => {
    const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter(
      (r) => r.offsetParent !== null && r.textContent.trim().length > 0,
    );
    const root = roots[roots.length - 1];
    const btn = [...(root?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent.trim() === l && b.offsetParent !== null,
    );
    btn?.click();
    return Boolean(btn);
  }, label);

const clickCard = (title) =>
  page.evaluate((t) => {
    const cards = [...document.querySelectorAll(".mantine-Card-root")].filter((c) =>
      c.textContent.trim().startsWith(t),
    );
    if (cards.length === 0) return false;
    cards[cards.length - 1].click();
    return true;
  }, title);

/** 卡片 draggable 属性（Q6c/D29：仅浏览模式可拖）。 */
const cardDraggable = (title) =>
  page.evaluate((t) => {
    const card = [...document.querySelectorAll(".mantine-Card-root")].find((c) =>
      c.textContent.trim().startsWith(t),
    );
    return card ? card.getAttribute("draggable") === "true" : null;
  }, title);

/** 合成 HTML5 拖放：dragstart(卡) → dragover/drop(目标列)。 */
const dragCardToColumn = (cardTitle, colTitle) =>
  page.evaluate(
    ({ card, col }) => {
      const cardEl = [...document.querySelectorAll(".mantine-Card-root")].find((c) =>
        c.textContent.trim().startsWith(card),
      );
      // Q19c：列标题改文本+点击编辑 —— 列容器用 data-col-title 锚定
      const colDiv = document.querySelector(`[data-col-title="${col}"]`);
      if (!cardEl || !colDiv) return false;
      const dt = new DataTransfer();
      cardEl.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true, cancelable: true }));
      colDiv.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      colDiv.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    },
    { card: cardTitle, col: colTitle },
  );

const cardInColumn = (colTitle, cardTitle) =>
  page.evaluate(
    ({ col, card }) => {
      // Q19c：列标题改文本+点击编辑 —— 列容器用 data-col-title 锚定
      const colDiv = document.querySelector(`[data-col-title="${col}"]`);
      return (colDiv?.textContent ?? "").includes(card);
    },
    { col: colTitle, card: cardTitle },
  );

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 前置：重置首页布局为 seed（历史运行会累积看板组件，输入框索引/列名会歧义）
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
  await sleep(500);

  // 建板（数据源管理 · 看板 —— Q26c：组件内不再建板）
  const boardTitle = `kan-${uniq}`;
  ok("KAN open data source manager", await clickBtn("数据源管理"));
  await sleep(500);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "看板");
    tab?.click();
  });
  await sleep(300);
  ok("KAN open new-board form", await clickBtn("＋ 新建看板")); // Q29e/五.4：入右上角按需展开
  await sleep(300);
  ok("KAN type new board name", await fillNth("新看板名", 0, boardTitle));
  await page.keyboard.press("Enter");
  await sleep(800);
  ok("KAN board created in manager", await page.evaluate((t) => (document.body.textContent ?? "").includes(t), boardTitle));
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("返回工作台"))?.click(),
  );
  await sleep(500);

  // 添加看板组件（Q26c#3：看板在「配置」里选，头部只显标题）
  ok("KAN enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("KAN open picker", await clickBtn("添加组件"));
  await sleep(300);
  ok("KAN pick 看板", await clickBtn("看板"));
  await sleep(400);
  ok("KAN add kanban widget (no board yet)", await clickBtn("确认添加", true));
  await sleep(1000);
  ok(
    "KAN empty-state hint",
    await page.evaluate(() => (document.body.textContent ?? "").includes("请到「数据源管理 · 看板」创建") && (document.body.textContent ?? "").includes("去创建看板")),
  );
  // 编辑态内容惰性（FR-P8）：composer 入口点击无效
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("＋ 添加列"));
    btn?.click();
  });
  await sleep(300);
  ok(
    "KAN composer inert in edit mode",
    await page.evaluate(() => ![...document.querySelectorAll("input")].some((i) => i.placeholder === "列名" && i.offsetParent !== null)),
  );
  // 配置里选看板（scoped：页面上每个组件外框都有「配置」按钮）
  ok(
    "KAN open config",
    await page.evaluate(() => {
      const title = document.querySelector(".wb-kanban__board-title");
      const chrome = title?.closest(".wb-chrome");
      const btn = [...(chrome?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(400);
  ok("KAN select board in config", await selectOption("看板", boardTitle));
  await sleep(300);
  ok("KAN save config", await clickInTopModal("保存配置"));
  await sleep(800);
  ok("KAN exit edit to operate cards", await clickBtn("完成编辑"));
  await sleep(400);
  ok(
    "KAN board title shown in header",
    await page.evaluate((t) => document.querySelector(".wb-kanban__board-title")?.textContent === t, boardTitle),
  );

  // ② 加列（Q27d：唯一入口 = 数据源管理 · 看板）/ 加卡（整列点按）
  const addColumnViaAdmin = async (name) => {
    await clickBtn("数据源管理");
    await sleep(500);
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "看板");
      tab?.click();
    });
    await sleep(300);
    // 显式选板（管理页默认 boards[0]，未必是本旅程的看板）
    await page.evaluate(() => document.querySelector('[aria-label="看板选择"]')?.click());
    await sleep(300);
    await page.evaluate((t) => {
      const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.textContent.includes(t));
      opt?.click();
    }, boardTitle);
    await sleep(300);
    await fillNth("列名", 0, name);
    await page.keyboard.press("Enter");
    await sleep(600);
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].find((b) => b.textContent.includes("返回工作台"))?.click(),
    );
    await sleep(500);
    return true;
  };
  ok("KAN add column 待办", await addColumnViaAdmin("待办"));
  ok("KAN add column 进行中", await addColumnViaAdmin("进行中"));
  ok(
    "KAN columns rendered",
    await page.evaluate(() => {
      const titles = [...document.querySelectorAll("[data-col-title]")].map((e) =>
        e.getAttribute("data-col-title"),
      );
      return titles.includes("待办") && titles.includes("进行中");
    }),
  );
  ok("KAN open add-card composer (click column)", await clickInColumn("待办", "＋ 添加卡片"));
  ok("KAN add card", await fillNth("卡片标题", 0, cardA));
  await page.keyboard.press("Enter");
  await sleep(800);
  ok("KAN card rendered in 待办", await cardInColumn("待办", cardA));

  // ③ 改卡（标题）
  ok("KAN open card editor", await clickCard(cardA));
  await sleep(400);
  ok("KAN edit card title", await setField("标题", cardB));
  await sleep(200);
  ok("KAN save card", await clickBtn("保存", true));
  await sleep(800);
  ok("KAN card updated", await cardInColumn("待办", cardB));

  // ④ 移动到其它列
  ok("KAN open card editor again", await clickCard(cardB));
  await sleep(400);
  ok("KAN move to 进行中", await selectOption("移动到", "进行中"));
  await sleep(800);
  ok("KAN card moved into 进行中", await cardInColumn("进行中", cardB));
  ok("KAN card left 待办", !(await cardInColumn("待办", cardB)));

  // ⑤ 归档
  ok("KAN open card editor for archive", await clickCard(cardB));
  await sleep(400);
  ok("KAN archive card", await clickBtn("归档", true));
  await sleep(800);
  ok(
    "KAN archived card hidden + counted",
    await page.evaluate(() => (document.body.textContent ?? "").includes("已归档 1")),
  );

  // 另一列再加一张卡（刷新/拖拽断言用）
  ok("KAN add card in 进行中", await clickInColumn("进行中", "＋ 添加卡片"));
  await sleep(200);
  ok("KAN type card in 进行中", await fillNth("卡片标题", 0, cardC));
  await page.keyboard.press("Enter");
  await sleep(800);

  // 编辑模式：卡片不可拖（拖动 = 布局）+ 提示 + 内容惰性（Q6c/D29 + FR-P8）
  ok("KAN re-enter edit", await clickBtn("编辑页面"));
  await sleep(400);
  const draggableInEdit = await cardDraggable(cardC);
  ok("KAN cards not draggable in edit mode", draggableInEdit === false, `draggable=${draggableInEdit}`);
  ok(
    "KAN edit-mode drag hint shown",
    await page.evaluate(() => (document.body.textContent ?? "").includes("编辑模式：拖动 = 调整布局")),
  );
  ok("KAN exit edit before reload checks", await clickBtn("完成编辑"));
  await sleep(400);

  // ⑥ 刷新：看板选择（props）与数据保持
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE long-poll keeps network busy
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(1200);
  ok("KAN board selection persists (props round-trip)", await page.evaluate((t) => document.querySelector(".wb-kanban__board-title")?.textContent === t, boardTitle));
  ok("KAN columns persist after reload", await cardInColumn("进行中", cardC));
  ok(
    "KAN archived stays archived",
    await page.evaluate((t) => !(document.body.textContent ?? "").includes(t), cardB),
  );

  // ⑦ 浏览模式卡片拖拽（HTML5 DnD，D29）：拖到 待办 列 = 跨列移动
  const draggableInBrowse = await cardDraggable(cardC);
  ok("KAN cards draggable in browse mode", draggableInBrowse === true, `draggable=${draggableInBrowse}`);
  ok("KAN drag card to 待办", await dragCardToColumn(cardC, "待办"));
  await sleep(1000);
  ok("KAN dragged card landed in 待办", await cardInColumn("待办", cardC));
  ok("KAN dragged card left 进行中", !(await cardInColumn("进行中", cardC)));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
