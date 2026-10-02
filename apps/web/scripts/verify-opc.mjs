/**
 * OPC acceptance (Q8 OpenCode 组件, FR-E4/D32): 会话列表/状态/耗时 + API 版本探测 ——
 *  ① 正常 API：版本徽标、会话列表（标题/耗时/更新时间）、令牌注入（Bearer）；
 *  ② experimental 形状不符：显式"探测失败"提示（不空白）。
 * mock opencode API 在脚本内起 HTTP 服务（同 verify-j5/j6 模式）。
 * Run: node scripts/verify-opc.mjs (server :3000 with ALLOW_PRIVATE_OUTBOUND=1,
 *      preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { login, makeClickBtn, makeOk, sleep, uniqId } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）
const uniq = uniqId(); // TST-8：时间戳+随机，防同毫秒重名/残留互撞

let seenAuth = null;
let dataCalls = 0;
const good = createServer((req, res) => {
  seenAuth = req.headers.authorization ?? null;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/app") {
    res.end(JSON.stringify({ name: "opencode", version: "9.9.9-test" }));
  } else if (req.url === "/session") {
    res.end(
      JSON.stringify([
        { id: `s-a-${uniq}`, title: `修复登录问题-${uniq}`, time: { created: 1000, updated: 65_000 } },
        { id: `s-b-${uniq}`, title: `写周报-${uniq}`, time: { created: 2000, updated: 2500 } },
      ]),
    );
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((r) => good.listen(0, "127.0.0.1", r));
const goodUrl = `http://127.0.0.1:${good.address().port}`;

const weird = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ nope: true }));
});
await new Promise((r) => weird.listen(0, "127.0.0.1", r));
const weirdUrl = `http://127.0.0.1:${weird.address().port}`;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on("request", (r) => {
  if (r.url().includes("/api/widgets/data")) dataCalls++;
});

const clickBtn = makeClickBtn(page); // TST-12/14：精确优先匹配（首个命中陷阱消解）

const setField = (label, value) =>
  page.evaluate(
    ({ l, v }) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      const target = wrapper?.querySelector("input, textarea");
      if (!target) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(target, v);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { l: label, v: value },
  );

const selectOption = async (label, optionText) => {
  await page.evaluate((l) => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes(l),
    );
    wrapper?.querySelector("[role=combobox]")?.click();
  }, label);
  await sleep(300);
  return page.evaluate((o) => {
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.textContent.includes(o));
    opt?.click();
    return Boolean(opt);
  }, optionText);
};

// Q42：连接信息在「数据源管理 · 数据连接」维护（SEC3：令牌入凭证库，连接仅存引用）
const createOpencodeSource = (name, url, token) =>
  page.evaluate(
    async ({ name, url, token }) => {
      let apiToken;
      if (token) {
        const cred = await (
          await fetch("/api/credentials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `${name}-cred`, kind: "http-header", secret: token }),
          })
        ).json();
        apiToken = { credentialRef: cred.id };
      }
      const res = await fetch("/api/data-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "opencode",
          name,
          config: apiToken ? { url, apiToken } : { url },
        }),
      });
      return res.ok;
    },
    { name, url, token },
  );

// Q42：添加组件 = 只选数据连接（连接信息不在组件表单重填）
const addOpencodeWidget = async (sourceName, refreshSec) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn("OpenCode"))) return false;
  await sleep(400);
  const selectOnly = await page.evaluate(
    () => ![...document.querySelectorAll(".mantine-Modal-root label")].some((l) => l.textContent.includes("服务地址") || l.textContent.includes("访问令牌")),
  );
  if (!selectOnly) return false;
  if (!(await selectOption("数据连接", sourceName))) return false;
  if (refreshSec && !(await setField("刷新频率", String(refreshSec)))) return false;
  await sleep(200);
  return clickBtn("确认添加", true);
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 前置：重置首页布局（组件累积会干扰定位）
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

  // 前置：数据连接（Q42 —— 组件只做选择，连接信息在「数据源管理 · 数据连接」维护）
  const srcGood = `OC 源-${uniq}`;
  const srcWeird = `OC 异形源-${uniq}`;
  ok("OPC create data source (good)", await createOpencodeSource(srcGood, goodUrl, "sk-opc"));
  ok("OPC create data source (incompatible)", await createOpencodeSource(srcWeird, weirdUrl, null));

  // ① 正常 API（refreshSec=3600：定时刷新单测走另一个组件，避免相互污染）
  ok("OPC enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("OPC add opencode widget (select-only form)", await addOpencodeWidget(srcGood, 3600));
  await sleep(2500);
  const bodyText = await page.evaluate(() => document.body.textContent ?? "");
  ok("OPC version badge (API probe)", bodyText.includes("v9.9.9-test"), bodyText.slice(-140));
  ok("OPC session titles rendered", bodyText.includes(`修复登录问题-${uniq}`) && bodyText.includes(`写周报-${uniq}`));
  ok("OPC duration badge derived (耗时)", bodyText.includes("1 分") && bodyText.includes("秒"), "");
  ok("OPC updated time shown", bodyText.includes("更新于"));
  ok("OPC bearer token injected (SEC3)", seenAuth === "Bearer sk-opc", String(seenAuth));

  // FR-I2：刷新频率是配置的一部分（重开配置面板可见并持久化）
  ok(
    "OPC open config for refresh check",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) =>
        (i.textContent ?? "").includes("OpenCode 会话"),
      );
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
      if (!btn) return false;
      btn.click();
      return true;
    }),
  );
  await sleep(500);
  const refreshSecValue = await page.evaluate(() => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes("刷新频率"),
    );
    return wrapper?.querySelector("input")?.value ?? null;
  });
  ok("FR-I2 refresh frequency persisted in config (refreshSec=3600)", refreshSecValue === "3600", String(refreshSecValue));
  await page.keyboard.press("Escape");
  await sleep(300);

  // 刷新按钮（数据通道有 5s 最小间隔限流 —— 等待间隔后手动刷新应回源；scoped 到本组件）
  seenAuth = null;
  await sleep(5200);
  ok(
    "OPC refresh button",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) =>
        (i.textContent ?? "").includes("OpenCode 会话"),
      );
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "刷新");
      if (!btn) return false;
      btn.click();
      return true;
    }),
  );
  await sleep(1500);
  ok("OPC refresh refetches", seenAuth === "Bearer sk-opc", String(seenAuth));

  // ② experimental 形状不符 → 显式探测失败提示（该组件 refreshSec=10 用于定时刷新断言）
  ok("OPC add widget against incompatible API", await addOpencodeWidget(srcWeird, 10));
  await sleep(2500);
  const body2 = await page.evaluate(() => document.body.textContent ?? "");
  ok("OPC incompatible API surfaced explicitly", body2.includes("无法读取 opencode API") && body2.includes("形状不符"), body2.slice(-160));
  ok("OPC probe-failure badge", body2.includes("探测失败"));

  // FR-I3：定时刷新（refreshSec=10 → 13s 内自动再次请求数据通道，无需手动刷新）
  const baseline = dataCalls;
  await sleep(13_000);
  ok("FR-I3 scheduled refresh fires without manual action", dataCalls > baseline, `${baseline} -> ${dataCalls}`);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
good.close();
weird.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
