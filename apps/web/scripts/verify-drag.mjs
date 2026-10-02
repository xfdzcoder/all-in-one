/**
 * verify-drag —— Q25b 拖拽体验验收（B 方案：插入位跟随指针 + 中插）：
 *  ① 占位框出现在两卡之间（跟随鼠标落点，非固定列尾）；
 *  ② 松手后按占位位置中插（sortOrder 重排），同列移动不错位；
 *  ③ dragleave 子元素冒泡不丢落点（含属判定）——以占位稳定存在间接验证。
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

try {
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle0" });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);
  await page.evaluate(async () => {
    const J = (u, m, b) =>
      fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) =>
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
  await sleep(1500);

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
  ok(before.join() === "卡A,卡B,卡C", "DRAG fixture has 3 cards", before.join());
  await sleep(300);

  // ① 占位跟随指针：hover 卡C 上沿 → 占位应在卡B、卡C之间（全列表序 2）
  const mid = await page.evaluate(() => {
    const target = document.querySelector('[data-col-title="列一"]');
    const cards = [...document.querySelectorAll("[data-card-id]")];
    const slot = [...target.querySelectorAll(".wb-kanban__drop-slot")].map((s) => s.getBoundingClientRect().top);
    const tops = cards.map((c) => c.getBoundingClientRect().top);
    return { slotAt: slot.length ? tops.filter((t) => t < slot[0]).length : -1 };
  });
  ok(mid.slotAt === 2, "DRAG placeholder follows pointer (between B and C)", `slotAt=${mid.slotAt}`);

  // ② 松手中插
  await page.evaluate(() => {
    const target = document.querySelector('[data-col-title="列一"]');
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: window.__dt, bubbles: true, cancelable: true, clientY: window.__y }),
    );
  });
  await sleep(1500);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll("[data-card-id]")].map((c) => c.textContent.trim().slice(0, 3)),
  );
  ok(after.join() === "卡B,卡A,卡C", "DRAG drop inserts at placeholder position", after.join());
} catch (e) {
  fail += 1;
  console.log("FAIL  DRAG journey crashed:", e instanceof Error ? e.message : String(e));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
