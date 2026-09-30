/**
 * 深色模式对比度快检（WCAG AA）：对当前可见的文本元素计算与实际底色的对比度，
 * 正文 ≥4.5:1、大号文本（≥24px 或 ≥18.66px 粗体）≥3:1。覆盖主界面 / 插件管理弹窗 /
 * 组件选择器三类表面（弹层/下拉最容易出问题）。
 * Run: node scripts/verify-dark.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT_FN = `(() => {
  const parse = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => {
    const [r, g, b] = parse(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "transparent" && !/^rgba\\(0, 0, 0, 0\\)$/.test(bg)) return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor || "rgb(20, 24, 31)";
  };
  const failures = [];
  let checked = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("iframe")) continue;
    // 禁用态组件豁免 WCAG 1.4.3（inactive components）
    if (el.closest("[disabled]") || el.closest('[aria-disabled="true"]') || el.closest("button:disabled")) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const got = ratio(cs.color, bgOf(el));
    checked++;
    if (got < need) {
      failures.push({
        text: text.slice(0, 24),
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 40),
        color: cs.color,
        bg: bgOf(el),
        size,
        ratio: Math.round(got * 100) / 100,
        need,
      });
    }
  }
  return { checked, failures };
})()`;

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

const report = (name, audit) => {
  ok(
    name,
    audit.failures.length === 0,
    `checked=${audit.checked}` +
      (audit.failures.length
        ? ` 失败 ${audit.failures.length} 处: ` + JSON.stringify(audit.failures.slice(0, 6))
        : ""),
  );
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(800);

  report("DARK main surface AA", await page.evaluate(AUDIT_FN));

  // 弹层表面：插件管理
  await clickBtn("插件管理");
  await sleep(600);
  report("DARK modal surface AA", await page.evaluate(AUDIT_FN));
  await page.keyboard.press("Escape");
  await sleep(400);

  // 选择器表面：添加组件
  await clickBtn("编辑页面");
  await sleep(300);
  await clickBtn("添加组件");
  await sleep(500);
  report("DARK picker surface AA", await page.evaluate(AUDIT_FN));
  await page.keyboard.press("Escape");
  await sleep(300);
  await clickBtn("完成编辑");
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
