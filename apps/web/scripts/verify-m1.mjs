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
await page.setViewport({ width: 1400, height: 900 });

const clickBtn = (label) =>
  page.evaluate((l) => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes(l));
    if (!btn) return false;
    btn.click();
    return true;
  }, label);

try {
  // J1: login screen renders
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]");
  ok("J1 login screen renders", true);

  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  ok("J1 login lands on default dashboard", true);

  const count = await page.$$eval(".grid-stack-item", (els) => els.length);
  ok("J1 default 首页 with example widgets", count >= 3, `${count} widgets`);

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
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(400);
  const y2 = Number(await gs("seed-1", "gs-y"));
  ok("J2 auto-save + reload restores moved position", y1 === y2 && y2 > y0, `moved=${y1} restored=${y2}`);

  // props round-trip: add widget (props {title: "N100"}), save, reload, check props survive
  ok("J2b re-enter edit mode", await clickBtn("编辑布局"));
  await sleep(300);
  const countBefore = await page.$$eval(".grid-stack-item", (els) => els.length);
  ok("J2b add widget", await clickBtn("添加组件"));
  await sleep(300);
  const addedTitle = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".grid-stack-item strong")];
    const found = els.map((e) => e.textContent).filter((t) => t.startsWith("N"));
    return found.at(-1) ?? null;
  });
  await sleep(1500); // debounce save
  await page.reload({ waitUntil: "networkidle0" });
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
  await page.type('input[placeholder="新页面名"]', uniq);
  ok("multi-dashboard create", await clickBtn("新建页面"));
  await sleep(800);
  const tabs = await page.$$eval('[role="tab"]', (els) => els.map((e) => e.textContent));
  ok("multi-dashboard tab appears", tabs.includes(uniq), JSON.stringify(tabs));

  // multi-dashboard: new page is empty (no seed), switch back to 首页 keeps widgets
  const countHome = await page.$$eval(".grid-stack-item", (els) => els.length);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "首页");
    tab?.click();
  });
  await sleep(600);
  const countHome2 = await page.$$eval(".grid-stack-item", (els) => els.length);
  ok("multi-dashboard switch keeps widgets", countHome2 >= countBefore, `new page=${countHome} home=${countHome2}`);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
