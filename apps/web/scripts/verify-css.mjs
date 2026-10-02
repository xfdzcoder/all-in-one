/**
 * verify-css —— 自定义 CSS 编辑器（设置 · 外观，FR-S3/Q111 **D70**）真机验收：
 *  ① 编辑器渲染（CodeMirror）+ **代码提示**：值位置给 `--wb-*` 令牌、选择器位置给 `.wb-*` 类名
 *     （提示数据 = `?raw` 提取 tokens.css/widgets.css —— 本脚本是该管道的全链路验证）；
 *  ② 保存即生效（`/custom.css` 穿透缓存重取 + 内容可对账）+ **自动备份旧版**；
 *  ③ 回滚到历史版本（回滚前的版本也备份）。
 * 保存前轻校验（lintCss）不阻断保存。
 *
 * ⚠ 会写真实实例的 `./data/custom.css`：脚本开头记下原内容、**结尾 Node 侧 PUT 还原**；
 * 且服务端每次保存都自动备份，双保险。
 * Run: node scripts/verify-css.mjs（server :3000 + preview :4173）
 */
import puppeteer from "puppeteer-core";
import { ADMIN_PASSWORD, login, makeOk, openSettings, sleep, summarize, uniqId } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173";
const results = [];
const ok = makeOk(results);
const uniq = uniqId("css-");
const TEST_CSS = `:root { --wb-color-accent: hotpink; } /* ${uniq} */`;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

/** Node 侧同源 fetch（收尾还原用，浏览器无关）。 */
const apiNode = async (path, { method = "POST", body, cookie } = {}) => {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    json: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    })(),
    cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
  };
};

const panelText = () =>
  page.evaluate(() => document.querySelector(".wb-settings__panel")?.textContent ?? "");

/** 在编辑器里输入（全选替换）并取补全候选。 */
const typeInEditor = async (text, { replaceAll = true } = {}) => {
  await page.click(".wb-css-editor .cm-content");
  if (replaceAll) {
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
  }
  await page.keyboard.type(text);
  await sleep(500);
  return page.evaluate(() => [...document.querySelectorAll(".cm-completionLabel")].map((n) => n.textContent ?? ""));
};

let originalCss = "";

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page);
  // Node 侧先取原始内容；文件本就为空时垫一行基线 —— 否则「首次保存无旧版可备份」
  // 是正确行为，测不到备份/回滚链路（收尾会把原内容原样写回）。
  const session = await apiNode("/api/auth/login", { body: { username: "admin", password: ADMIN_PASSWORD } });
  const cookie = session.cookie;
  const initial = await apiNode("/api/styles/custom-css", { method: "GET", cookie });
  originalCss = String(initial.json.css ?? "");
  if (!originalCss.trim()) {
    await apiNode("/api/styles/custom-css", {
      method: "PUT",
      body: { css: `/* verify-css baseline ${uniq} */` },
      cookie,
    });
  }
  await openSettings(page, "外观");
  await sleep(800);
  ok("CSS appearance panel opens", (await panelText()).includes("自定义 CSS"));
  ok("CSS editor rendered (CodeMirror)", await page.evaluate(() => Boolean(document.querySelector(".wb-css-editor .cm-content"))));

  // ── ① 代码提示（?raw → 提取 → 补全 UI 全链路）──
  const valueLabels = await typeInEditor("--wb-");
  ok(
    "CSS completion offers --wb-* tokens (D70)",
    valueLabels.some((l) => l.replace(/^var\(/, "").startsWith("--wb-color-accent")),
    JSON.stringify(valueLabels.slice(0, 6)),
  );
  await page.keyboard.press("Escape");
  const classLabels = await typeInEditor(".wb-set");
  ok(
    "CSS completion offers .wb-* semantic classes (D70)",
    classLabels.some((l) => l.includes("wb-settings")),
    JSON.stringify(classLabels.slice(0, 6)),
  );
  await page.keyboard.press("Escape");

  // ── ② 保存即生效 + 自动备份 ──
  await typeInEditor(TEST_CSS);
  ok("CSS save button clicked", await page.evaluate(() => {
    const b = [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").includes("保存 CSS"));
    b?.click();
    return Boolean(b);
  }));
  await sleep(1000);
  ok("CSS save success message", (await panelText()).includes("已保存"), (await panelText()).slice(0, 120));

  // 生效对账：/custom.css 合成下发里应含测试内容（且 link 带 v= 穿透缓存）
  const served = await page.evaluate(async () => (await fetch(`/custom.css?t=${Date.now()}`)).text());
  ok("CSS actually served via /custom.css (生效)", served.includes(TEST_CSS) && served.includes("hotpink"));
  ok(
    "CSS link busted cache (即时生效)",
    await page.evaluate(() => {
      const link = document.querySelector('link[rel="stylesheet"][href*="custom.css"]');
      return Boolean(link && /[?&]v=\d+/.test(link.getAttribute("href") ?? ""));
    }),
  );

  // 备份清单：保存前的旧内容已进历史
  // ── ③ 回滚到保存前版本 ──
  await page.evaluate(() => {
    const input = [...document.querySelectorAll(".wb-settings__panel input")].find(
      (i) => i.getAttribute("role") === "combobox" || (i.placeholder ?? "").includes("回滚"),
    );
    input?.click();
  });
  await sleep(500);
  ok("CSS backup option visible", await page.evaluate(() => Boolean(document.querySelector("[data-combobox-option]"))));
  ok(
    "CSS backup created on save（历史条目带大小，可回滚）",
    await page.evaluate(() => {
      const opt = document.querySelector("[data-combobox-option]");
      return (opt?.textContent ?? "").includes("字节");
    }),
    await page.evaluate(() => document.querySelector("[data-combobox-option]")?.textContent ?? "(no option)"),
  );
  await page.evaluate(() => {
    document.querySelector("[data-combobox-option]")?.click();
  });
  await sleep(300);
  ok("CSS restore clicked", await page.evaluate(() => {
    const b = [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").trim() === "回滚");
    b?.click();
    return Boolean(b);
  }));
  await sleep(1000);
  ok("CSS restore success message", (await panelText()).includes("已回滚"), (await panelText()).slice(0, 120));
  const servedAfter = await page.evaluate(async () => (await fetch(`/custom.css?t=${Date.now()}`)).text());
  ok("CSS content restored (hotpink gone)", !servedAfter.includes("hotpink"));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

// ── 收尾还原（Node 侧，浏览器无关）：把原内容原样写回 ──
try {
  const session = await apiNode("/api/auth/login", {
    body: { username: "admin", password: ADMIN_PASSWORD },
  });
  const put = await apiNode("/api/styles/custom-css", {
    method: "PUT",
    body: { css: originalCss },
    cookie: session.cookie,
  });
  ok("CSS original content restored (clean exit)", put.status === 200, `status=${put.status}`);
} catch (e) {
  ok("CSS original content restored (clean exit)", false, String(e).slice(0, 160));
}

await browser.close();
summarize(results);
process.exit(results.some((r) => !r.pass) ? 1 : 0);
