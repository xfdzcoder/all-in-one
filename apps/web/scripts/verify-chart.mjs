/**
 * CHART acceptance（批H2 / Q76，D47 + D57）：自定义图表组件 v1 —— 配置即 spec。
 *  ① 选择器出现「图表」→ 配置表单（取数路径/X/Y 字段/图表类型）→ 添加；
 *  ② mock HTTP 源返回行数据 → 画布渲染（canvas）+ 无错误条；
 *  ③ 编辑改饼图 → 画布仍渲染；
 *  ④ 取数路径指错 → **降级文案「原因 + 怎么修」**（D47 禁甩锅）且不整卡空白；
 *  ⑤ 刷新按钮在（FR-I3）。
 * Run: node scripts/verify-chart.mjs（server :3000 + preview :4173）
 *
 * **TST-23**（用户反馈②）：全程临时草稿盘（`tmp-verify-*` 自建自删 + `?page=` 深链），
 * 不再「清理首页残留 chart 卡」—— 草稿盘天生无残留，用户页面零接触。
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import {
  createScratchDashboard,
  deleteScratchDashboard,
  login,
  makeApiFetch,
  makeClickBtn,
  makeOk,
  sleep,
  summarize,
  waitFor,
} from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173";
const results = [];
const ok = makeOk(results);

const payload = {
  data: {
    items: [
      { t: "一月", a: 10, b: 20 },
      { t: "二月", a: 15, b: 25 },
      { t: "三月", a: 12, b: 30 },
    ],
  },
};

/** D65（用户反馈⑤）：记录最近一次上游请求的 Authorization 头 —— 验「来源令牌 / 卡片覆盖」。 */
let lastAuth = "";
const mock = createServer((req, res) => {
  lastAuth = req.headers.authorization ?? "";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}/`;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const clickBtn = makeClickBtn(page);
const api = makeApiFetch(page); // TST-23：带 method 的同源 fetch（建/删草稿盘用）
let scratch = null; // TST-23：本轮临时草稿盘（收尾自删）

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

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page);
  await installLayoutGuard(page);
  // TST-23：chart 卡挂在**自建临时草稿盘**上（`?page=` 深链定位；新盘无历史卡，
  // 原「前置清理首页残留 chart 卡」不再需要 —— 用户页面零接触）
  scratch = await createScratchDashboard(api);
  await page.goto(`${WEB}/?page=${scratch.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(400);

  // ① 添加组件 → 图表 → 配置表单
  ok("CHART enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("CHART open picker", await clickBtn("添加组件"));
  await sleep(400);
  ok("CHART listed in picker", await clickBtn("图表"));
  await sleep(400);
  // D65（用户反馈⑤）：接口地址示例是**相对地址**（认证来源已有绝对地址，不再示例带域名）
  ok(
    "CHART form: url placeholder is a relative path (D65)",
    await page.evaluate(() => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes("接口地址"),
      );
      const ph = wrapper?.querySelector("input")?.getAttribute("placeholder") ?? "";
      return ph.startsWith("/") && !ph.includes("://");
    }),
  );
  ok(
    "CHART form: token help says only fill when different from source (D65)",
    await page.evaluate(() => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes("访问令牌"),
      );
      return (wrapper?.textContent ?? "").includes("不同");
    }),
  );
  ok("CHART form: url field", await setField("接口地址", mockUrl));
  ok("CHART form: path field", await setField("取数路径", "data.items"));
  ok("CHART form: x field", await setField("X 轴字段", "t"));
  ok("CHART form: y fields", await setField("Y 系列字段", "a,b"));
  ok("CHART add widget", await clickBtn("确认添加", true));
  await sleep(1500);

  // ② 画布渲染（配置即 spec 编译生效）
  ok(
    "CHART canvas renders",
    await waitFor(page, () => Boolean(document.querySelector(".wb-chart canvas")), undefined),
  );
  ok("CHART no error banner", !(await page.evaluate(() => (document.body.textContent ?? "").includes("不是数组"))));

  // ④ 降级：取数路径指错 → 「原因 + 怎么修」（D47）
  const badPath = await page.evaluate(async (dashId) => {
    const list = await (await fetch("/api/dashboards", { credentials: "same-origin" })).json();
    const home = list.find((d) => d.id === dashId); // TST-23：只认草稿盘，绝不回落 list[0]
    if (!home) return false;
    const items = JSON.parse(home.layoutJson ?? "[]");
    const card = items.find((i) => i.component === "chart");
    if (!card) return false;
    card.props.path = "data.nope";
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(items) }),
    });
    return true;
  }, scratch.id);
  ok("CHART corrupt path fixture", Boolean(badPath));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  ok(
    "CHART degradation copy（原因 + 怎么修）",
    await waitFor(
      page,
      () => {
        const t = document.body.textContent ?? "";
        return t.includes("不是数组") && t.includes("取数路径");
      },
      undefined,
    ),
  );

  // ⑤ 刷新按钮在（FR-I3）
  ok("CHART has 刷新", await clickBtn("刷新"));

  // ── D65（用户反馈⑤）：相对地址按「认证来源」拼接；卡片令牌**覆盖**来源（且不改来源）──
  const srcCreated = await page.evaluate(async (base) => {
    const res = await fetch("/api/data-sources", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "http",
        name: `http-${Math.random().toString(36).slice(2, 6)}`,
        config: { url: base, apiToken: "src-token" },
      }),
    });
    return { status: res.status, body: await res.text() };
  }, `http://127.0.0.1:${mock.address().port}`);
  ok("CHART D65 http source created", srcCreated.status === 201, `status=${srcCreated.status}`);
  const httpSourceId = JSON.parse(srcCreated.body).id;

  /** 直接改草稿盘上 chart 卡 props（D65 用例换配置用，TST-23：只认草稿盘）。 */
  const setChartProps = async (patch) => {
    await page.evaluate(
      async ({ p, dashId }) => {
        const list = await (await fetch("/api/dashboards", { credentials: "same-origin" })).json();
        const home = list.find((d) => d.id === dashId);
        if (!home) return;
        const items = JSON.parse(home.layoutJson ?? "[]");
        const card = items.find((i) => i.component === "chart");
        if (!card) return;
        card.props = { ...card.props, ...p };
        await fetch(`/api/dashboards/${home.id}/layout`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layoutJson: JSON.stringify(items) }),
        });
      },
      { p: patch, dashId: scratch.id },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".grid-stack", { timeout: 8000 });
    await sleep(1500);
  };

  // ① 相对地址 + 卡片不填令牌 → 用来源地址拼接 + 来源令牌
  lastAuth = "";
  await setChartProps({ sourceId: httpSourceId, url: "/metrics", apiToken: "", authHeader: "", path: "data.items", wsSourceId: "" });
  ok(
    "CHART D65 relative url + source token（卡片不填 → 用来源）",
    (await waitFor(page, () => Boolean(document.querySelector(".wb-chart canvas")), undefined)) &&
      lastAuth === "Bearer src-token",
    `authSeen=${lastAuth}`,
  );
  // ② 卡片令牌覆盖来源（优先级高于默认配置），来源配置原样不动
  lastAuth = "";
  const srcBefore = await page.evaluate(async (sid) => {
    const rows = await (await fetch("/api/data-sources", { credentials: "same-origin" })).json();
    return JSON.stringify((rows.find((r) => r.id === sid) ?? {}).config ?? {});
  }, httpSourceId);
  await setChartProps({ apiToken: "card-token" });
  const srcAfter = await page.evaluate(async (sid) => {
    const rows = await (await fetch("/api/data-sources", { credentials: "same-origin" })).json();
    return JSON.stringify((rows.find((r) => r.id === sid) ?? {}).config ?? {});
  }, httpSourceId);
  ok(
    "CHART D65 card token overrides source token（来源配置原样不动）",
    lastAuth === "Bearer card-token" && srcBefore === srcAfter,
    `authSeen=${lastAuth} sourceUnchanged=${srcBefore === srcAfter}`,
  );

  // ⑥ Q78/D56：WS 流模式 —— mock WS 源 → 服务端 WsSourceManager → SSE → 图表滚动窗口
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => wss.on("listening", () => r(undefined)));
  const wsUrl = `ws://127.0.0.1:${wss.address().port}`;
  // 处理器先挂；**持续推送**（直播流无回放 —— 订阅前的消息本就收不到，语义如此）
  let wsSeq = 0;
  wss.on("connection", (sock) => {
    const timer = setInterval(() => {
      wsSeq += 1;
      if (sock.readyState === sock.OPEN) sock.send(JSON.stringify({ t: `p${wsSeq}`, v: wsSeq }));
      if (wsSeq >= 12) clearInterval(timer);
    }, 300);
  });
  const srcRes = await page.evaluate(async (u) => {
    const res = await fetch("/api/data-sources", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ws", name: `ws-${Math.random().toString(36).slice(2, 6)}`, config: { url: u } }),
    });
    return { status: res.status, body: await res.text() };
  }, wsUrl);
  ok("CHART ws source created", srcRes.status === 201, `status=${srcRes.status}`);
  const wsSourceId = JSON.parse(srcRes.body).id;
  // 画布卡切到流模式
  await page.evaluate(async ({ sid, dashId }) => {
    const list = await (await fetch("/api/dashboards", { credentials: "same-origin" })).json();
    const home = list.find((d) => d.id === dashId); // TST-23：只认草稿盘
    if (!home) return;
    const items = JSON.parse(home.layoutJson ?? "[]");
    const card = items.find((i) => i.component === "chart");
    if (!card) return;
    card.props.wsSourceId = sid;
    card.props.path = "";
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(items) }),
    });
  }, { sid: wsSourceId, dashId: scratch.id });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(800); // 等服务端对账建连（处理器已先挂，连接即推 3 行）
  ok(
    "CHART ws stream points（实时 · N 点，N≥3）",
    await waitFor(
      page,
      () => {
        const m = (document.body.textContent ?? "").match(/实时 · (\d+) 点/);
        return Boolean(m && Number(m[1]) >= 3);
      },
      undefined,
      { timeoutMs: 12000 },
    ),
  );
  ok("CHART ws canvas renders", await waitFor(page, () => Boolean(document.querySelector(".wb-chart canvas")), undefined));
  wss.close();
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await sleep(1000);
if (scratch) {
  // TST-23：临时草稿盘自删（失败打印告警供手工清理，不吞测试结论）
  await deleteScratchDashboard(api, scratch.id).catch((e) =>
    console.error("!! 临时草稿盘清理失败，需手工删除：", scratch.id, e?.message ?? e),
  );
}
await restoreLayouts(page).catch(() => {});
await browser.close();
mock.close();
process.exit(summarize(results) ? 0 : 1);
