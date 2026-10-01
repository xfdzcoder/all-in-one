/**
 * FR3 acceptance (FR-I3 手动刷新按钮 + 回源语义，Q14b):
 *  ① 五个数据组件（Todo/信息流/自定义 API/应用入口/看板）都有「刷新」按钮且浏览模式可用；
 *  ② 点击即回源 —— widgets/data 通道的强制刷新（force）穿透服务端 TTL 缓存（mock 计数），
 *     REST 型组件产生新的列表请求。
 * Run: node scripts/verify-fr3.mjs (server :3000 with ALLOW_PRIVATE_OUTBOUND=1,
 *      preview :4173)
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

let apiHits = 0;
const apiMock = createServer((_req, res) => {
  apiHits++;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, n: apiHits }));
});
await new Promise((r) => apiMock.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${apiMock.address().port}/metrics`;

let probeHits = 0;
const probeMock = createServer((_req, res) => {
  probeHits++;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});
await new Promise((r) => probeMock.listen(0, "127.0.0.1", r));
const probeUrl = `http://127.0.0.1:${probeMock.address().port}/`;

let todoHits = 0;
let kanbanHits = 0;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/todos")) todoHits++;
  if (u.includes("/api/kanban/boards/")) kanbanHits++;
});

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

const setField = (label, value) =>
  page.evaluate(
    ({ l, v }) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      const target = wrapper?.querySelector("input, textarea");
      if (!target) return false;
      const proto =
        target.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(target, v);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { l: label, v: value },
  );

/** 在含 marker 的组件内点击「刷新」。 */
const clickRefreshIn = (marker) =>
  page.evaluate((m) => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(m));
    const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "刷新");
    if (!btn) return false;
    btn.click();
    return true;
  }, marker);

const hasRefreshIn = (marker) =>
  page.evaluate((m) => {
    const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(m));
    return [...(item?.querySelectorAll("button") ?? [])].some((b) => b.textContent.trim() === "刷新");
  }, marker);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 前置：重置首页布局（seed 含 Todo + 信息流）
  await page.evaluate(async () => {
    const seed = [
      { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
      { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
      { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
      { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
      { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
    ];
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页") ?? list[0]; // 回落首屏：真机/历史库可能没有「首页」（Q82 同款）
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // 添加三个组件（自定义 API / 应用入口 / 看板）
  ok("FR3 enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("FR3 add custom-api", await clickBtn("添加组件") && (await sleep(300), await clickBtn("自定义 API")));
  await sleep(400);
  ok("FR3 custom-api url", await setField("接口地址", apiUrl));
  await sleep(200);
  ok("FR3 custom-api submit", await clickBtn("确认添加", true));
  await sleep(1500);

  ok("FR3 add launcher", await clickBtn("添加组件"));
  await sleep(300);
  ok("FR3 pick launcher", await clickBtn("应用入口"));
  await sleep(400);
  ok(
    "FR3 launcher items",
    await setField("服务列表 JSON", JSON.stringify([{ name: "Mock", url: probeUrl, probe: "http" }])),
  );
  await sleep(200);
  ok("FR3 launcher submit", await clickBtn("确认添加", true));
  await sleep(1500);

  ok("FR3 add kanban", await clickBtn("添加组件"));
  await sleep(300);
  ok("FR3 pick kanban", await clickBtn("看板"));
  await sleep(400);
  ok("FR3 kanban submit", await clickBtn("确认添加", true));
  await sleep(1500);
  // 看板组件需选定看板才会拉取看板树（Q26c：建板 API 播种、组件配置里选板）
  await page.evaluate(async () => {
    await fetch("/api/kanban/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "fr3-board" }),
    });
  });
  await sleep(400);
  const opened = await page.evaluate(() => {
    const title = document.querySelector(".wb-kanban__board-title");
    const chrome = title?.closest(".wb-chrome");
    const btn = [...(chrome?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
    btn?.click();
    return Boolean(btn);
  });
  ok("FR3 kanban open config", opened);
  await sleep(400);
  ok(
    "FR3 kanban select board in config",
    await page.evaluate(() => {
      const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter(
        (r) => r.offsetParent !== null && r.textContent.trim().length > 0,
      );
      const root = roots[roots.length - 1];
      const wrapper = [...(root?.querySelectorAll(".mantine-InputWrapper-root") ?? [])].find((w) =>
        w.querySelector("label")?.textContent.includes("看板"),
      );
      wrapper?.querySelector("[role=combobox]")?.click();
      return Boolean(wrapper);
    }),
  );
  await sleep(500);
  ok(
    "FR3 kanban pick board",
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) =>
        e.textContent.includes("fr3-board"),
      );
      opt?.click();
      return Boolean(opt);
    }),
  );
  await sleep(300);
  ok(
    "FR3 kanban save config",
    await page.evaluate(() => {
      const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter(
        (r) => r.offsetParent !== null && r.textContent.trim().length > 0,
      );
      const root = roots[roots.length - 1];
      const btn = [...(root?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent.trim() === "保存配置" && b.offsetParent !== null,
      );
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(1500);

  // 浏览模式（手动刷新 = 组件内操作，不应依赖编辑模式）
  ok("FR3 exit edit (browse mode)", await clickBtn("完成编辑"));
  await sleep(400);

  // ① 刷新按钮统一存在
  ok("FR3 todo has 刷新", await hasRefreshIn("Todo ·"));
  ok("FR3 rss has 刷新", await hasRefreshIn("RSS")); // Q85 起信息流标题改为「RSS」
  ok("FR3 custom-api has 刷新", await hasRefreshIn("自定义 API"));
  ok("FR3 launcher has 刷新", await hasRefreshIn("应用入口"));
  ok("FR3 kanban has 刷新", await hasRefreshIn("fr3-board"));

  // ② 点击即回源（force 穿透服务端缓存 / REST 重新取数）
  const t0 = todoHits;
  ok("FR3 todo refresh", await clickRefreshIn("Todo ·"));
  await sleep(1200);
  ok("FR3 todo refetched", todoHits > t0, `${t0} -> ${todoHits}`);

  const k0 = kanbanHits;
  ok("FR3 kanban refresh", await clickRefreshIn("fr3-board"));
  await sleep(1200);
  ok("FR3 kanban refetched", kanbanHits > k0, `${k0} -> ${kanbanHits}`);

  const a0 = apiHits;
  ok("FR3 custom-api refresh", await clickRefreshIn("自定义 API"));
  await sleep(1500);
  ok("FR3 custom-api upstream hit (force bypasses TTL)", apiHits > a0, `${a0} -> ${apiHits}`);

  const p0 = probeHits;
  ok("FR3 launcher refresh", await clickRefreshIn("应用入口"));
  await sleep(1500);
  ok("FR3 launcher probe hit (force bypasses TTL)", probeHits > p0, `${p0} -> ${probeHits}`);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
apiMock.close();
probeMock.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
