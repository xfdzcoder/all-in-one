/**
 * verify-gray —— D54 批A2「全局去灰」回归守卫（项 11）：
 * 用户反馈"邮件行背景 / Todo 新任务输入框都是这类灰色，和主题配色不搭，全局优化掉"。
 *
 * 根因：Mantine 用中性灰阶做组件底色（深色 `--mantine-color-dark-6` = #2e2e2e，
 * Card / Input / Checkbox / Menu / Popover / Table / Progress 等 40+ 处引用）。
 * 修复 = styles-bridge 把 dark / gray 两个色阶整阶映射到 --wb-* tinted slate 令牌。
 *
 * 断言口径（对应用户原话"全局搜一下"）：
 *  ① **全 DOM 扫描**：遍历所有可见元素的计算 background-color，不得出现"浊中性灰"
 *     （r==g==b 且 30<=r<=220 —— 正是 #2e2e2e 那类灰）；白/近白不算灰（浅色主题设计如此）。
 *  ② 变量层：`--mantine-color-dark-6` / `gray-6` 必须解析到 --wb-* 表面（非 #2e2e2e）。
 *  ③ 深色主题下被采样的表面必须带蓝紫偏（B 通道 > R 通道），证明 bridge 真的生效。
 *  ④ 深浅双主题各跑一遍。
 * Run: node scripts/verify-gray.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { ADMIN_PASSWORD, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

/** 页面扫描：浊中性灰元素清单 + 代表性表面 + 关键变量解析值 */
const scan = () =>
  page.evaluate(() => {
    const parse = (css) => {
      const m = (css ?? "").match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const muddy = (c) => c && c.a > 0.05 && c.r === c.g && c.g === c.b && c.r >= 30 && c.r <= 220;

    // ① 全 DOM 扫描浊中性灰（排除媒体/画布/图标容器 —— 它们的底色来自内容而非主题）
    const offenders = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("*")) {
      if (["IMG", "CANVAS", "SVG", "PATH", "VIDEO", "IFRAME"].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const c = parse(cs.backgroundColor);
      if (!muddy(c)) continue;
      const key = `${el.className || el.tagName}|${cs.backgroundColor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 70),
        bg: cs.backgroundColor,
      });
      if (offenders.length >= 12) break;
    }

    // ② 变量层解析（var() 链求值，见下）
    const vars = {};
    for (const k of ["--mantine-color-dark-6", "--mantine-color-gray-6", "--mantine-color-body", "--mantine-color-default"]) {
      // var() 不会被 getComputedStyle 解析 —— 用临时探针求值出最终颜色
      const probe = document.createElement("div");
      probe.style.cssText = `position:absolute;visibility:hidden;background:var(${k})`;
      document.body.appendChild(probe);
      vars[k] = getComputedStyle(probe).backgroundColor;
      probe.remove();
    }

    // ③ 代表性表面（存在的才采样）
    const pick = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    return {
      offenders,
      vars,
      samples: {
        "Todo 新任务输入框": pick("input[placeholder='新任务…']"),
        "默认按钮": pick(".mantine-Button-root"),
        "图标按钮": pick(".mantine-ActionIcon-root"),
        "指标卡": pick(".wb-metric"),
        "邮件行": pick(".wb-mail-row"),
        "组件卡片": pick(".wb-widget"),
      },
    };
  });

const judge = (r, theme) => {
  // ① 全站不得有浊中性灰
  ok(`${theme} 全站无浊中性灰`, r.offenders.length === 0, r.offenders.length ? JSON.stringify(r.offenders) : "");

  // ② 变量层不得解析成 #2e2e2e
  // 注：`dark-*` 只在深色域重映射 —— 浅色下 color="dark" 徽标等仍需真实深色盘，
  // 故浅色主题跳过该键（其是否漏到可见面由上面的全站扫描守卫）。
  for (const [k, v] of Object.entries(r.vars)) {
    if (theme !== "深色" && k === "--mantine-color-dark-6") {
      ok(`${theme} ${k} 按设计保留 Mantine 原值`, /rgb\(46,\s*46,\s*46\)/.test(v), `${k} = ${v}`);
      continue;
    }
    const isDefault = /rgb\(46,\s*46,\s*46\)/.test(v);
    ok(`${theme} ${k} 已映射`, !isDefault && Boolean(v), `${k} = ${v}`);
  }

  // ③ 深色主题：采样表面应带蓝紫偏（B>R），浅色主题只要不浊即可
  for (const [name, bg] of Object.entries(r.samples)) {
    if (!bg) continue;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) continue;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const pass = theme === "深色" ? p[2] > p[0] : !(p[0] === p[1] && p[1] === p[2] && p[0] >= 30 && p[0] <= 220);
    ok(`${theme} · ${name}`, pass, `bg=${bg}`);
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
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);
  await sleep(500);

  // 铺一组覆盖 Input / Card / Button / Checkbox 的组件
  await page.evaluate(async () => {
    const seed = [
      { id: "g-1", x: 0, y: 0, w: 6, h: 5, component: "todo", props: { name: "灰检", filter: "all" } },
      { id: "g-2", x: 6, y: 0, w: 6, h: 5, component: "mail", props: { limit: 5 } },
      { id: "g-3", x: 0, y: 5, w: 6, h: 4, component: "StatBox", props: { label: "灰检", value: "OK" } },
    ];
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页") ?? list[0];
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
  });
  // 登录后 /api/events 是 SSE 长连接 —— reload 只等 domcontentloaded，networkidle0 永不达成
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
  await sleep(900);

  judge(await scan(), "深色");

  await page.evaluate(() => {
    localStorage.setItem("wb-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 15000 });
  await sleep(900);
  judge(await scan(), "浅色");

  await page.evaluate(() => {
    localStorage.setItem("wb-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  });
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("失败项：");
  for (const f of failed) console.log(`  - ${f.name}  ${f.detail}`);
  process.exit(1);
}
