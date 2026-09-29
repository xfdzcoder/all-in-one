/**
 * J6 acceptance: app launcher — add via widget picker (itemsJson config, FR-W2),
 * HTTP/TCP alive probing through the server data channel (FR-W3/D22 LAN probe path),
 * status display (per-item badge + up/total counter), click-through opens the service.
 * Run: node scripts/verify-j6.mjs (server :3000 with ALLOW_PRIVATE_OUTBOUND=1 —
 * loopback probing is the widget's core use case, preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mock upstream: alive HTTP service (probe: http → 200 alive)
const alive = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("mock-ok");
});
await new Promise((r) => alive.listen(0, "127.0.0.1", r));
const aliveUrl = `http://127.0.0.1:${alive.address().port}/`;

// dead service: reserve a free port then close it (probe: tcp → connect refused)
const tmp = createServer();
await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
const deadUrl = `http://127.0.0.1:${tmp.address().port}/`;
await new Promise((r) => tmp.close(r));

const items = [
  { name: "Mock-Alive", url: aliveUrl, probe: "http" },
  { name: "Mock-Dead", url: deadUrl, probe: "tcp" },
];

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

/** FR-W2 选择器流程：添加组件 → 选 manifest → configSchema 表单 → 确认添加。 */
const setField = (kind, label, value) =>
  page.evaluate(
    ({ kind: k, label: l, value: v }) => {
      const root = document.querySelector(".mantine-Modal-root");
      const wrapper = [...root.querySelectorAll(".mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      const target = wrapper?.querySelector(k === "json" ? "textarea" : "input");
      if (!target) return false;
      const proto = k === "json" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(target, v);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { kind, label, value },
  );

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  ok("J6 enter edit", await clickBtn("编辑布局"));
  await sleep(300);
  ok("J6 open widget picker", await clickBtn("添加组件"));
  await sleep(300);
  ok("J6 pick 应用入口", await clickBtn("应用入口"));
  await sleep(400);

  ok("J6 itemsJson field (configSchema-driven)", await setField("json", "服务列表 JSON", JSON.stringify(items)));
  await sleep(200);
  ok("J6 submit config form", await clickBtn("确认添加", true));
  await sleep(500);

  // 状态展示：探活结果（1/2 在线 = HTTP mock 存活 + TCP 端口拒绝，两条探测路径都生效）
  let state = null;
  for (let i = 0; i < 20 && !state; i++) {
    await sleep(500);
    state = await page.evaluate((urls) => {
      const text = document.body.textContent ?? "";
      const counter = text.match(/(\d+)\/(\d+) 在线/);
      if (!counter) return null;
      const badgeColor = (url) => {
        const a = [...document.querySelectorAll("a[href]")].find((e) => e.getAttribute("href") === url);
        const badge = a?.querySelector(".mantine-Badge-root");
        return badge ? getComputedStyle(badge).backgroundColor : null;
      };
      return {
        counter: counter[0],
        up: Number(counter[1]),
        total: Number(counter[2]),
        aliveColor: badgeColor(urls.alive),
        deadColor: badgeColor(urls.dead),
        names: urls.names.every((n) => text.includes(n)),
        links: urls.all.every((u) => {
          const a = [...document.querySelectorAll("a[href]")].find((e) => e.getAttribute("href") === u);
          return a && a.getAttribute("target") === "_blank";
        }),
      };
    }, { alive: aliveUrl, dead: deadUrl, all: [aliveUrl, deadUrl], names: ["Mock-Alive", "Mock-Dead"] });
  }
  ok("J6 probe counter shows 1/2 在线", Boolean(state) && state.up === 1 && state.total === 2, state?.counter ?? "no counter");
  ok("J6 per-item alive/dead badges differ (green vs red)", Boolean(state) && state.aliveColor !== state.deadColor && Boolean(state.aliveColor), `${state?.aliveColor} vs ${state?.deadColor}`);
  ok("J6 service entries listed with links", Boolean(state) && state.names && state.links);

  // 点击跳转：浏览器直接打开服务（target=_blank，不经服务端）
  const before = (await browser.targets()).length;
  const link = await page.$(`a[href="${aliveUrl}"]`);
  ok("J6 service link exists", Boolean(link));
  if (link) {
    await link.click();
    const target = await browser.waitForTarget((t) => t.opener() === page.target(), { timeout: 8000 }).catch(() => null);
    ok("J6 click-through opens service in new tab", Boolean(target), target ? target.url() : "no new tab");
    if (target) {
      ok("J6 click-through lands on service URL", target.url().startsWith(aliveUrl), target.url());
      await target.page().then((p) => p?.close());
    }
  }
  ok("J6 no extra tabs leaked", (await browser.targets()).length === before, `${before} -> ${(await browser.targets()).length}`);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
alive.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
