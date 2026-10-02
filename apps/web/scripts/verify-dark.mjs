/**
 * 深色模式对比度快检（WCAG AA）：对当前可见的文本元素计算与实际底色的对比度，
 * 正文 ≥4.5:1、大号文本（≥24px 或 ≥18.66px 粗体）≥3:1。覆盖主界面 / 插件管理弹窗 /
 * 组件选择器三类表面（弹层/下拉最容易出问题）。
 * Run: node scripts/verify-dark.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";
import { login, makeClickBtn, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

const AUDIT_FN = `(() => {
  // 颜色解析：兼容 rgb()/rgba()（0-255）与 color(srgb …)（0-1，Chrome color-mix 序列化）；alpha 逐层合成
  const parse = (c) => {
    const nums = (c.match(/-?[\\d.]+/g) || []).map(Number);
    if (!nums.length) return null;
    if (c.includes("srgb")) {
      const [r, g, b, a = 1] = nums;
      return [r * 255, g * 255, b * 255, a];
    }
    const [r, g, b, a = 1] = nums;
    return [r, g, b, a];
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
  const bgOf = (el) => {
    const layers = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const p = parse(getComputedStyle(n).backgroundColor);
      if (p && p[3] > 0) layers.push(p);
      if (p && p[3] >= 1) break;
      n = n.parentElement;
    }
    let base = parse(getComputedStyle(document.body).backgroundColor) ?? [20, 24, 31, 1];
    if (base[3] < 1) base = [...over(base, [255, 255, 255, 1]), 1];
    for (let i = layers.length - 1; i >= 0; i--) base = [...over(layers[i], base), 1];
    return base;
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
    const bg = bgOf(el);
    const fg = over(parse(cs.color), bg); // 半透明文字先合成到底色
    const l1 = lum(fg);
    const l2 = lum(bg);
    const got = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    checked++;
    if (got < need) {
      failures.push({
        text: text.slice(0, 24),
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 40),
        color: cs.color,
        bg: "rgb(" + bg.map(Math.round).join(",") + ")",
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

const clickBtn = makeClickBtn(page); // TST-12/14：精确优先匹配（首个命中陷阱消解）

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
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
  await sleep(800);

  // Q63（D52 双主题）：深浅两套主题各查三种表面
  const runThemeChecks = async (label) => {
    report(`${label} main surface AA`, await page.evaluate(AUDIT_FN));

    // 弹层表面：插件管理
    await clickBtn("插件管理");
    await sleep(600);
    report(`${label} modal surface AA`, await page.evaluate(AUDIT_FN));
    await page.keyboard.press("Escape");
    await sleep(400);

    // 选择器表面：添加组件
    await clickBtn("编辑页面");
    await sleep(300);
    await clickBtn("添加组件");
    await sleep(500);
    report(`${label} picker surface AA`, await page.evaluate(AUDIT_FN));
    await page.keyboard.press("Escape");
    await sleep(300);
    await clickBtn("完成编辑");
    await sleep(300);

    // Q90（项 6）：顶栏底色 = **surface 层**，不是页面底色（原先落到 --wb-color-bg 发灰）
    const bar = await page.evaluate(() => {
      const probe = (v) => {
        const d = document.createElement("div");
        d.style.backgroundColor = `var(${v})`;
        document.body.appendChild(d);
        const c = getComputedStyle(d).backgroundColor;
        d.remove();
        return c;
      };
      const h = document.querySelector("header");
      const cs = h ? getComputedStyle(h) : null;
      return {
        bg: cs?.backgroundColor ?? null,
        borderBottom: cs?.borderBottomWidth ?? null,
        surface: probe("--wb-color-surface"),
        pageBg: probe("--wb-color-bg"),
      };
    });
    ok(
      `${label} topbar is a surface layer with divider (Q90 项 6)`,
      bar.bg !== null && bar.bg === bar.surface && bar.bg !== bar.pageBg && bar.borderBottom !== "0px",
      JSON.stringify(bar),
    );
  };

  await runThemeChecks("DARK");

  await page.evaluate(() => localStorage.setItem("wb-theme", "light"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(1000);
  await runThemeChecks("LIGHT");

  // Q90（项 9）：滚动条**不含固定的顶栏** —— 滚动容器是 AppShell.Main，不是文档视口
  const scroll = await page.evaluate(() => {
    const main = document.querySelector(".wb-main");
    const cs = main ? getComputedStyle(main) : null;
    return {
      bodyOverflow: getComputedStyle(document.body).overflow,
      mainScrolls: cs?.overflowY === "auto" || cs?.overflowY === "scroll",
      mainHeight: cs?.height ?? null,
      // 文档本身不该再滚（否则滚动条会贯穿含顶栏的整个窗口）
      docScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    };
  });
  ok(
    "Q90 scrollbar excludes the fixed topbar (项 9)",
    scroll.bodyOverflow === "hidden" && scroll.mainScrolls && scroll.docScrolls === false,
    JSON.stringify(scroll),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
