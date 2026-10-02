/**
 * verify-iframe-live —— 嵌入页面卡**真机验收**（D47 §4/§5 + **D67**）：
 * 用户反馈「iframe 里的请求的 Origin 是 null，导致报错跨域」——真机上把**真实服务**
 * 嵌进卡片，直接读**框内文档的 `location.origin`**（沙箱缺 allow-same-origin 时它是
 * 字符串 "null"，这就是用户看到的跨域根因）：必须等于目标站自身 origin。
 * 反面：真机自带 `X-Frame-Options: DENY` 的服务（Navidrome）应出「无法嵌入」提示。
 *
 * 地址来源：`.opencode/.env.verify`（gitignored；只读 URL，不打印任何密钥）；缺 URL 则 SKIP。
 * Run: node scripts/verify-iframe-live.mjs（server :3000 + preview :4173）
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { login, makeApiFetch, makeOk, sleep, summarize, waitFor, withScratchDashboard } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173";
const results = [];
const ok = makeOk(results);

const envFile = join(import.meta.dirname, "../../../.opencode/.env.verify");
const env = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) env[line.slice(0, i)] = line.slice(i + 1);
  }
}
const EMBED_URL = (env.VERIFY_IMMICH_URL || env.IMMICH_URL || "").replace(/\/+$/, "");
const BLOCKED_URL = (env.VERIFY_NAVIDROME_URL || env.NAVIDROME_URL || "").replace(/\/+$/, "");
if (!EMBED_URL && !BLOCKED_URL) {
  console.log("SKIP  verify-iframe-live：无 IMMICH_URL/NAVIDROME_URL（.opencode/.env.verify）");
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

/** 把 iframe 卡写进草稿盘布局（只写本轮自建盘，护栏在 kit）。 */
const putIframeLayout = async (apiFetch, dashId, url) => {
  const layout = [{ id: "live-iframe-1", x: 0, y: 0, w: 8, h: 6, component: "iframe", props: { url } }];
  const r = await apiFetch(`/api/dashboards/${dashId}/layout`, {
    method: "PUT",
    body: JSON.stringify({ layoutJson: JSON.stringify(layout) }),
  });
  return r.status === 200;
};

const frameOf = (url) =>
  page.frames().find((f) => {
    try {
      return new URL(f.url()).host === new URL(url).host;
    } catch {
      return false;
    }
  });

/** 轮询到目标帧出现（帧是异步挂载的；Node 侧轮询，页面上下文读不到 page.frames）。 */
const waitFrame = async (url, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const f = frameOf(url);
    if (f) return f;
    if (Date.now() > deadline) return undefined;
    await sleep(200);
  }
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page);
  const apiFetch = makeApiFetch(page);

  await withScratchDashboard(apiFetch, async (dash) => {
    if (EMBED_URL) {
      ok("LIVE-IFRAME put iframe card into scratch dashboard", await putIframeLayout(apiFetch, dash.id, EMBED_URL));
      await page.goto(`${WEB}/?page=${dash.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".grid-stack", { timeout: 8000 });

      // CDP 帧上下文不受同源策略限制 —— 直接读框内文档源（沙箱不透明时 = "null"）
      const frame = await waitFrame(EMBED_URL);
      const origin = frame ? await frame.evaluate(() => location.origin) : "(no-frame)";
      ok(
        `LIVE-IFRAME 真机框内 origin 非 null（D67，${new URL(EMBED_URL).host}）`,
        origin === new URL(EMBED_URL).origin,
        `frame.origin=${origin} expect=${new URL(EMBED_URL).origin}`,
      );
      const sandbox = await page.evaluate(
        (u) => [...document.querySelectorAll("iframe")].find((f) => f.getAttribute("src") === u)?.getAttribute("sandbox") ?? null,
        EMBED_URL,
      );
      ok("LIVE-IFRAME 默认沙箱含 allow-same-origin", sandbox === "allow-scripts allow-same-origin", `sandbox="${sandbox}"`);
    }

    if (BLOCKED_URL) {
      ok("LIVE-IFRAME put blocked-target card into scratch dashboard", await putIframeLayout(apiFetch, dash.id, BLOCKED_URL));
      await page.goto(`${WEB}/?page=${dash.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".grid-stack", { timeout: 8000 });
      // 真机 X-Frame-Options: DENY → 明确提示 + 逃生口（不是白屏）
      const shown = await waitFor(
        page,
        (u) => {
          const w = [...document.querySelectorAll(".wb-widget")].find((x) => x.querySelector(".wb-url")?.textContent?.trim() === u);
          return Boolean(w && (w.textContent ?? "").includes("无法嵌入此页面"));
        },
        BLOCKED_URL,
        { timeoutMs: 20000 },
      );
      ok(`LIVE-IFRAME 真机禁嵌给出明确提示（${new URL(BLOCKED_URL).host}）`, shown);
    }
  });
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
summarize(results);
process.exit(results.some((r) => !r.pass) ? 1 : 0);
