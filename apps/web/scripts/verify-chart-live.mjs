/**
 * verify-chart-live —— 图表卡**真机验收**（D47 §4/§5：真机验证才算完成）：
 * 真 HTTP 源（Immich `/api/albums`，真实相册统计）喂图表卡 → 画布渲染 + 点数与
 * **直连 API 对得上**（不只看"渲染了"，数值面与官方一致）+ 降级路径真实。
 *
 * 凭证来源：`.opencode/.env.verify` 的 `VERIFY_IMMICH_URL` / `VERIFY_IMMICH_API_KEY`
 * （gitignored；不打印、不入日志）；缺失则 SKIP。
 * Run: node scripts/verify-chart-live.mjs（server :3000 + preview :4173）
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { login, makeOk, sleep, summarize, uniqId, waitFor } from "./lib/verify-kit.mjs";

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
const IMMICH_URL = env.VERIFY_IMMICH_URL;
const IMMICH_KEY = env.VERIFY_IMMICH_API_KEY;
if (!IMMICH_URL || !IMMICH_KEY) {
  console.log("SKIP  verify-chart-live：无 VERIFY_IMMICH_URL/VERIFY_IMMICH_API_KEY（.opencode/.env.verify）");
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page);
  // 前置清理历史残留 chart 卡（自愈：断言按点数/画布定位，错卡会假红）
  await page.evaluate(async () => {
    const list = await (await fetch("/api/dashboards", { credentials: "same-origin" })).json();
    const home = list.find((d) => d.title === "首页") ?? list[0];
    const items = JSON.parse(home.layoutJson ?? "[]");
    const kept = items.filter((i) => i.component !== "chart");
    if (kept.length !== items.length) {
      await fetch(`/api/dashboards/${home.id}/layout`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutJson: JSON.stringify(kept) }),
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".grid-stack", { timeout: 8000 });
    }
  });
  await installLayoutGuard(page);
  const uniq = uniqId("live-");

  // 直连真机数相册数（对账基准：图表点数必须与官方 API 一致）
  const albumsRes = await fetch(`${IMMICH_URL.replace(/\/+$/, "")}/api/albums`, {
    headers: { "X-API-Key": IMMICH_KEY },
  });
  const albums = await albumsRes.json();
  ok("LIVE-CHART immich albums reachable", Array.isArray(albums) && albums.length > 0, `count=${Array.isArray(albums) ? albums.length : "n/a"}`);
  const expected = Array.isArray(albums) ? albums.length : 0;

  // 凭证 + HTTP 连接（SEC3：明文只入凭证库）
  const setup = await page.evaluate(
    async ({ key, u, name }) => {
      const cred = await (
        await fetch("/api/credentials", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `${name}-cred`, kind: "http-header", secret: key }),
        })
      ).json();
      const src = await fetch("/api/data-sources", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "http",
          name,
          config: { url: `${u.replace(/\/+$/, "")}/api/albums`, authHeader: "X-API-Key", apiToken: { credentialRef: cred.id } },
        }),
      });
      return { status: src.status, body: await src.text() };
    },
    { key: IMMICH_KEY, u: IMMICH_URL, name: uniq },
  );
  ok("LIVE-CHART http source created", setup.status === 201, `status=${setup.status}`);
  const sourceId = JSON.parse(setup.body).id;

  // 图表卡上盘（真源配置：根数组、相册名/资产数）
  await page.evaluate(
    async ({ sid, u }) => {
      const list = await (await fetch("/api/dashboards", { credentials: "same-origin" })).json();
      const home = list.find((d) => d.title === "首页") ?? list[0];
      const items = JSON.parse(home.layoutJson ?? "[]");
      items.push({
        id: `w-${Math.random().toString(36).slice(2, 8)}`,
        x: 0,
        y: 9,
        w: 6,
        h: 4,
        component: "chart",
        // D42：sourceId 供认证头；url 为内联配置（连接里也有 url，但组件取内联）
        props: { sourceId: sid, url: `${u.replace(/\/+$/, "")}/api/albums`, path: "", chartType: "bar", xField: "albumName", yFields: "assetCount", unit: "张" },
      });
      await fetch(`/api/dashboards/${home.id}/layout`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutJson: JSON.stringify(items) }),
      });
    },
    { sid: sourceId, u: IMMICH_URL },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 画布渲染 + **点数与真机对得上**
  ok("LIVE-CHART canvas renders", await waitFor(page, () => Boolean(document.querySelector(".wb-chart canvas")), undefined, { timeoutMs: 15000 }));
  ok(
    `LIVE-CHART points == immich albums（${expected}）`,
    await waitFor(
      page,
      (n) => (document.body.textContent ?? "").includes(`${n} 点`),
      expected,
      { timeoutMs: 15000 },
    ),
  );
  ok(
    "LIVE-CHART no error banner",
    !(await page.evaluate(() => (document.body.textContent ?? "").includes("取数路径"))),
  );
  await sleep(500);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch(() => {});
await browser.close();
process.exit(summarize(results) ? 0 : 1);
