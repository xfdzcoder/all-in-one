/**
 * verify-drag —— Q25b 拖拽体验验收（B 方案：插入位跟随指针 + 中插）：
 *  ① 占位框出现在两卡之间（跟随鼠标落点，非固定列尾）；
 *  ② 松手后按占位位置中插（sortOrder 重排），同列移动不错位；
 *  ③ dragleave 子元素冒泡不丢落点（含属判定）——以占位稳定存在间接验证。
 */
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { ADMIN_PASSWORD, makeOk, summarize, waitFor } from "./lib/verify-kit.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; // TST-15：统一记账
const ok = makeOk(results); // TST-15：签名统一 (name, pass, detail)（原 cond,label 反序族，调用点已对调）

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

try {
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle0" });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);
  await page.evaluate(async () => {
    const J = (u, m, b) =>
      fetch(u, { method: m, headers: { "Content-Type": "application/json" }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => // GET 禁带 body
        r.json(),
      );
    const b = await J("/api/kanban/boards", "POST", { title: `drag-${Date.now()}` });
    const col = await J("/api/kanban/columns", "POST", { boardId: b.id, title: "列一" });
    for (const t of ["卡A", "卡B", "卡C"]) await J("/api/kanban/cards", "POST", { columnId: col.id, title: t });
    const seed = [{ id: "k1", x: 0, y: 0, w: 6, h: 6, component: "kanban", props: { boardId: b.id } }];
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页") ?? list[0]; // 回落首屏：真机/历史库可能没有「首页」（Q82 同款，TST-10）
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await waitFor(page, () => { const cs = [...document.querySelectorAll("[data-card-id]")]; return cs.length >= 3 && cs.every((c) => c.getBoundingClientRect().height > 0) && document.querySelectorAll(".grid-stack-item[gs-y]").length > 0; }, undefined); // TST-13：几何+定位就绪（浅条件曾致拖拽坐标算早）

  const before = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-card-id]")];
    const target = document.querySelector('[data-col-title="列一"]');
    const cC = cards[2].getBoundingClientRect();
    const dt = new DataTransfer();
    cards[0].dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__dt = dt;
    window.__y = cC.top + 2;
    target.dispatchEvent(
      new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true, clientY: window.__y }),
    );
    return cards.map((c) => c.textContent.trim().slice(0, 3));
  });
  ok( "DRAG fixture has 3 cards",before.join() === "卡A,卡B,卡C", before.join());
  await sleep(300);

  // ① 占位跟随指针：hover 卡C 上沿 → 占位应在卡B、卡C之间（全列表序 2）
  const mid = await page.evaluate(() => {
    const target = document.querySelector('[data-col-title="列一"]');
    const cards = [...document.querySelectorAll("[data-card-id]")];
    const slot = [...target.querySelectorAll(".wb-kanban__drop-slot")].map((s) => s.getBoundingClientRect().top);
    const tops = cards.map((c) => c.getBoundingClientRect().top);
    return { slotAt: slot.length ? tops.filter((t) => t < slot[0]).length : -1 };
  });
  ok( "DRAG placeholder follows pointer (between B and C)",mid.slotAt === 2, `slotAt=${mid.slotAt}`);

  // ② 松手中插
  await page.evaluate(() => {
    const target = document.querySelector('[data-col-title="列一"]');
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: window.__dt, bubbles: true, cancelable: true, clientY: window.__y }),
    );
  });
  // TST-13：等 React 按 drop 结果重排（原 sleep(1500) 是同帧读结果的确定性竞态）——
  // 轮询「顺序已变」；drop 失败则超时 → 下面的断言如实红
  await waitFor(
    page,
    (prev) =>
      [...document.querySelectorAll("[data-card-id]")].map((c) => c.textContent.trim().slice(0, 3)).join() !== prev,
    before.join(),
    { timeoutMs: 4000 },
  );
  const after = await page.evaluate(() =>
    [...document.querySelectorAll("[data-card-id]")].map((c) => c.textContent.trim().slice(0, 3)),
  );
  ok( "DRAG drop inserts at placeholder position",after.join() === "卡B,卡A,卡C", after.join());
} catch (e) {
  fail += 1;
  console.log("FAIL  DRAG journey crashed:", e instanceof Error ? e.message : String(e));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
process.exit(summarize(results) ? 0 : 1);
