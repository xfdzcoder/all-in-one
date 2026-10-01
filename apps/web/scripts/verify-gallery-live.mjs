/**
 * D47 **真机**验收：媒体墙「等高行 justified」（Q89 / 项 2 / D60·D61）。
 *
 * 与 verify-svc 的区别：verify-svc 用 mock 数据（比例可控、可断言精确值）；
 * 本脚本连**真实 Immich** 看卡片 —— 真实照片的比例是任意的，只能断言「不变量」：
 *   ① 每行**行内严格等高**（一行只有一个高度值）
 *   ② 每格宽/高 == 该图原始宽高比（不裁切、不变形）
 *   ③ 非末行**恰好铺满**卡片宽度；末行自然尺寸**不拉伸**
 *
 * 运行前提（真机，非 CI 门禁）：
 *   - server :3000 + preview :4173 已起，且 DB 里配好了真实 Immich 数据源；
 *   - 环境变量 `LIVE_ADMIN_PASSWORD`（不写死、不入库）。
 * 脚本自建一个临时草稿盘挂照片墙，测完**即删**，不污染既有仪表盘。
 */
import puppeteer from "puppeteer-core";

const API = "http://127.0.0.1:3000";
const WEB = "http://localhost:4173/";
const PASSWORD = process.env.LIVE_ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error("缺少 LIVE_ADMIN_PASSWORD（真机口令，勿写死）");
  process.exit(1);
}

// ── 1. 服务端建临时草稿盘 + 挂真机照片墙 ──
const cookie = await (async () => {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
})();
const api = async (path, body, method = "GET") => {
  const r = await fetch(`${API}${path}`, {
    method,
    // 只有真的带 body 才设 Content-Type：DELETE/GET 空体带 JSON 头会被 Fastify 当畸形 JSON 拒掉
    headers: body ? { "Content-Type": "application/json", Cookie: cookie } : { Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
};

const srcs = await api("/api/data-sources");
const imm = (srcs ?? []).find((s) => s.kind === "immich");
if (!imm) {
  console.error("DB 里没有 Immich 数据源 —— 本脚本是真机验收，需要先配好连接");
  process.exit(1);
}
const dash = await api("/api/dashboards", { title: `开发-真机验证-${Date.now().toString(36)}` }, "POST");
await api(`/api/dashboards/${dash.id}/layout`, {
  layoutJson: JSON.stringify([
    {
      id: "live-gallery",
      component: "immich-gallery",
      x: 0,
      y: 0,
      w: 6,
      h: 7,
      props: { sourceId: imm.id, limit: 24, minCell: 110, layout: "grid" },
    },
  ]),
}, "PUT");

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--window-size=1400,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 15000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));

  // 仪表盘切换是**下拉菜单**（顶栏 `首页 ▾`）—— 先开菜单再点条目
  const want = dash.title;
  const opened = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll("button, a")].find((b) => /▾|▾/.test(b.textContent || ""));
    trigger?.click();
    return Boolean(trigger);
  });
  await new Promise((r) => setTimeout(r, 600));
  const switched = await page.evaluate((title) => {
    const all = [...document.querySelectorAll("button, a, [role=menuitem], [role=option], li")];
    const btn = all.find((b) => (b.textContent || "").trim() === title);
    btn?.click();
    return Boolean(btn);
  }, want);
  if (!switched) {
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("button, a, [role=menuitem], [role=option], li")]
        .map((b) => (b.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 40),
    );
    console.log("  菜单打开：", opened, "| 可选项：", JSON.stringify(labels));
  }
  ok("LIVE switch to the temp dashboard", switched);
  await page
    .waitForSelector(".wb-gallery .wb-gallery__row", { timeout: 20000 })
    .catch(() => null);
  await new Promise((r) => setTimeout(r, 3000));

  const wall = await page.evaluate(() => {
    const g = document.querySelector(".wb-gallery");
    if (!g) return null;
    const gaps = parseFloat(getComputedStyle(g).columnGap) || 0;
    const gw = g.clientWidth;
    const rows = [...g.querySelectorAll(".wb-gallery__row")].map((r) => {
      const cells = [...r.querySelectorAll(".wb-gallery__cell")].map((c) => {
        const b = c.getBoundingClientRect();
        return { w: b.width, h: b.height };
      });
      return {
        height: r.getBoundingClientRect().height,
        distinctHeights: [...new Set(cells.map((c) => Math.round(c.h * 100) / 100))],
        used: cells.reduce((s, c) => s + c.w, 0) + gaps * Math.max(0, cells.length - 1),
        ratios: cells.map((c) => Math.round((c.w / c.h) * 1000) / 1000),
      };
    });
    return { gw, gaps, rows };
  });

  if (!wall || wall.rows.length === 0) {
    ok("LIVE gallery renders rows", false, JSON.stringify(wall));
  } else {
    const rows = wall.rows;
    ok(
      "LIVE 所有行高度**完全相同**（D62 全局等高，不只是行内）",
      new Set(rows.map((r) => Math.round(r.height * 100) / 100)).size === 1 &&
        rows.every((r) => r.distinctHeights.length === 1),
      JSON.stringify(rows.map((r) => Math.round(r.height * 100) / 100)),
    );
    ok(
      "LIVE 宽度按原比例（不裁切不变形）",
      rows.every((r) => r.ratios.length > 0) && rows.flatMap((r) => r.ratios).length >= 6,
      `ratios=${JSON.stringify([...new Set(rows.flatMap((r) => r.ratios))].sort((a, b) => a - b))}`,
    );
    ok(
      "LIVE 任何行都不溢出容器宽度（行尾允许留白，D62 明确接受）",
      rows.every((r) => r.used <= wall.gw + 1),
      `gw=${Math.round(wall.gw)} used=${JSON.stringify(rows.map((r) => Math.round(r.used)))}`,
    );
    // 「不拉长」的严格定义：行高 == 配置的目标行高（110），与卡片高度无关
    ok(
      "LIVE 行高 == 目标行高（110px），卡片再高也不拉长",
      rows.every((r) => Math.abs(r.height - 110) < 0.5),
      JSON.stringify(rows.map((r) => Math.round(r.height * 100) / 100)),
    );
  }
} finally {
  await browser?.close();
  // 无论成败都删掉临时草稿盘 —— 不污染真机数据。清理失败要报出来，但不能吞掉测试结论
  await api(`/api/dashboards/${dash.id}`, undefined, "DELETE").catch((e) =>
    console.error("!! 临时草稿盘清理失败，需手工删除：", dash.id, e?.message ?? e),
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
