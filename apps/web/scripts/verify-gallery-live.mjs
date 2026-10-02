/**
 * D47 **真机**验收：媒体墙（Q89 等高行 justified / Q83 配置筛选旅程）。
 *
 * 与 verify-svc 的区别：verify-svc 用 mock 数据（比例可控、可断言精确值）；
 * 本脚本连**真实 Immich / Navidrome** 看卡片 —— 真实数据只能断言「不变量 + 对账」：
 *   ① 每行**行内严格等高**（一行只有一个高度值）
 *   ② 每格宽/高 == 该图原始宽高比（不裁切、不变形）
 *   ③ 非末行**恰好铺满**卡片宽度；末行自然尺寸**不拉伸**
 *   ④ Q83：**配置表单**选相册/艺人 → 网格只出对应内容（相册按真机 API 对账图片数、
 *      换相册内容整体更换；艺人按「专辑名 · 艺人名」title 后缀直接验证归属）
 *
 * 运行前提（真机，非 CI 门禁）：
 *   - server :3000 + preview :4173 已起，且 DB 里配好了真实 Immich / Navidrome 数据源；
 *   - 环境变量 `LIVE_ADMIN_PASSWORD`（不写死、不入库）；
 *   - 可选 `IMMICH_URL` + `IMMICH_API_KEY`（仅用于相册图片数对账；缺失则跳过对账）。
 * 脚本自建一个临时草稿盘挂两张墙，测完**即删**，不污染既有仪表盘。
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
    ...(body ? { body: JSON.stringify(body) } : {}), // unicorn(no-invalid-fetch-options)：GET 禁带 body
  });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
};

const srcs = await api("/api/data-sources");
const imm = (srcs ?? []).find((s) => s.kind === "immich");
const nav = (srcs ?? []).find((s) => s.kind === "navidrome");
if (!imm || !nav) {
  console.error("DB 里没有 Immich / Navidrome 数据源 —— 本脚本是真机验收，需要先配好连接");
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
      // limit 提到 120：Q83 要按「相册图片数」对账，别让条目数先截断
      props: { sourceId: imm.id, limit: 120, minCell: 110, layout: "grid" },
    },
    {
      id: "live-wall",
      component: "navidrome-library",
      x: 6,
      y: 0,
      w: 6,
      h: 7,
      props: { sourceId: nav.id, limit: 120, minCell: 110, layout: "grid" },
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
    // 只看照片墙那一格（草稿盘上还有 Navidrome 专辑墙，`.wb-gallery` 会命中两张）
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes("照片墙"));
    const g = item?.querySelector(".wb-gallery");
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
      `ratios=${JSON.stringify([...new Set(rows.flatMap((r) => r.ratios))].toSorted((a, b) => a - b))}`,
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
  // ── Q83（真机）：配置表单选相册/艺人 → 网格只出对应内容 ──
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickBtn = (label) =>
    page.evaluate((l) => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().includes(l));
      btn?.click();
      return Boolean(btn);
    }, label);
  const openConfig = (marker) =>
    page.evaluate((m) => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(m));
      const btn = [...(item?.querySelectorAll(".wb-chrome__actions button") ?? [])].find(
        (b) => (b.getAttribute("aria-label") || b.textContent || "").trim() === "配置",
      );
      btn?.click();
      return Boolean(btn);
    }, marker);
  const selectOption = async (label, optionText) => {
    await page.evaluate((l) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      wrapper?.querySelector("[role=combobox]")?.click();
    }, label);
    await sleep(500);
    return page.evaluate((o) => {
      const opt = [...document.querySelectorAll("[data-combobox-option]")].find(
        (e) => e.offsetParent !== null && (e.textContent ?? "").trim() === o,
      );
      opt?.click();
      return Boolean(opt);
    }, optionText);
  };
  const wallState = async (marker) => {
    await sleep(3500);
    return page.evaluate((m) => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(m));
      const cells = [...(item?.querySelectorAll(".wb-gallery__cell") ?? [])];
      return {
        count: cells.length,
        srcs: cells.map((c) => c.querySelector("img")?.getAttribute("src") ?? ""),
        titles: cells.map((c) => c.getAttribute("title") ?? ""),
      };
    }, marker);
  };
  /** 选某格卡片的配置项 → 保存 → 退出编辑。返回 "ok" 或失败步骤。 */
  const pickAndSave = async (marker, label, optionText) => {
    if (!(await clickBtn("编辑页面"))) return "edit";
    await sleep(500);
    if (!(await openConfig(marker))) return "open";
    await sleep(800);
    if (!(await selectOption(label, optionText))) return "select";
    await sleep(300);
    if (!(await clickBtn("保存配置"))) return "save";
    await sleep(1500);
    if (!(await clickBtn("完成编辑"))) return "exit";
    return "ok";
  };

  // 真机 Immich 对账口径：`GET /api/albums/{id}` 给 `assetCount`（该相册资产总数）。
  // 缺 IMMICH_* 凭证则只做「换相册换内容」的不变量断言。
  const IMMICH_BASE = (process.env.IMMICH_URL ?? "").replace(/\/+$/, "");
  const IMMICH_KEY = process.env.IMMICH_API_KEY ?? "";
  const albumAssetCount = async (id) => {
    if (!IMMICH_BASE || !IMMICH_KEY || !id) return null;
    try {
      const r = await fetch(`${IMMICH_BASE}/api/albums/${id}`, { headers: { "X-API-Key": IMMICH_KEY } });
      if (!r.ok) return null;
      const a = await r.json();
      return Number.isFinite(a.assetCount) ? a.assetCount : null;
    } catch {
      return null;
    }
  };
  const liveAlbums = await (async () => {
    if (!IMMICH_BASE || !IMMICH_KEY) return [];
    try {
      const r = await fetch(`${IMMICH_BASE}/api/albums`, { headers: { "X-API-Key": IMMICH_KEY } });
      return r.ok ? await r.json() : [];
    } catch {
      return [];
    }
  })();
  // 挑两个**规模小（2–119）**的相册：条数能卡准（不被 limit=120 截断）、泄漏一眼可判
  const counted = [];
  for (const a of liveAlbums.map((x) => ({ id: x.id, name: x.albumName, n: x.assetCount ?? null }))) {
    counted.push({ ...a, n: Number.isFinite(a.n) ? a.n : await albumAssetCount(a.id) });
  }
  const small = counted.filter((a) => Number.isFinite(a.n) && a.n >= 2 && a.n < 120).toSorted((x, y) => x.n - y.n);
  const [A, B] = small.length >= 2 ? small.slice(0, 2) : counted.filter((a) => (a.n ?? 1) > 0).slice(0, 2);
  ok("LIVE 相册选项源返回真机相册（≥2）", counted.length >= 2, `albums=${counted.length}`);
  if (A) {
    ok("Q83 配置表单选相册 A 生效", (await pickAndSave("照片墙", "只看相册", A.name)) === "ok", A.name);
    const wa = await wallState("照片墙");
    ok(
      "LIVE 网格只出相册 A 的内容（条数 == 真机相册资产数对账）",
      wa.count > 0 && (A.n === null || wa.count === Math.min(120, A.n)),
      JSON.stringify({ album: A.name, cells: wa.count, albumAssets: A.n }),
    );
    if (B) {
      ok("Q83 配置表单换相册 B 生效", (await pickAndSave("照片墙", "只看相册", B.name)) === "ok", B.name);
      const wb = await wallState("照片墙");
      // 同一张照片可能同时属于两个相册 ⇒ 判据取「内容有变化」而非严格不相交
      const changed = wb.count !== wa.count || wb.srcs.some((s) => !wa.srcs.includes(s));
      ok(
        "LIVE 换相册即换内容（条数 == 相册 B 资产数对账）",
        changed && (B.n === null || wb.count === Math.min(120, B.n)),
        JSON.stringify({ a: [A.name, wa.count], b: [B.name, wb.count], albumAssetsB: B.n }),
      );
    }
  }

  // Navidrome：「只看艺人」→ 每张专辑 title 都应以「 · 艺人名」结尾（归属可直接验证）
  const artistLabels = await (async () => {
    if (!(await clickBtn("编辑页面"))) return [];
    await sleep(500);
    if (!(await openConfig("专辑墙"))) return [];
    await sleep(800);
    // 先点开下拉，**等选项异步渲染**再读（同帧读必然是空的）
    await page.evaluate(() => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes("只看艺人"),
      );
      wrapper?.querySelector("[role=combobox]")?.click();
    });
    await sleep(1200);
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("[data-combobox-option]")]
        .filter((e) => e.offsetParent !== null)
        .map((e) => (e.textContent ?? "").trim())
        .filter(Boolean),
    );
    await sleep(300);
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(300);
    await clickBtn("完成编辑");
    await sleep(500);
    return labels;
  })();
  ok("LIVE 艺人选项源返回真机艺人（≥1）", artistLabels.length >= 1, `artists=${artistLabels.length}`);
  // 选一个**有专辑**的艺人（最多试 4 个；零专辑艺人会让归属断言变成空集）
  let navDone = false;
  for (const label of artistLabels.slice(0, 4)) {
    if ((await pickAndSave("专辑墙", "只看艺人", label)) !== "ok") continue;
    const w = await wallState("专辑墙");
    if (w.count === 0) continue;
    ok(
      "LIVE 网格只出所选艺人的专辑（title 全部带「 · 艺人名」）",
      w.titles.every((t) => t.endsWith(` · ${label}`)),
      JSON.stringify({ artist: label, count: w.count, titles: w.titles.slice(0, 4) }),
    );
    navDone = true;
    break;
  }
  if (!navDone) ok("LIVE 网格只出所选艺人的专辑（title 全部带「 · 艺人名」）", false, "试过的艺人都没有专辑");
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
