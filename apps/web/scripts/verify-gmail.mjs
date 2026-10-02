/**
 * GMAIL acceptance (Q-G1/Q-G2 · D37 Gmail 打通):
 *  ① 「绑定 Gmail 账号」→ OAuth 授权 URL 参数正确（client_id/scope/redirect/state）——
 *     授权域指向本地哑端点，零外发；
 *  ② 回调旅程端到端：code → token 交换 → profile → 创建 gmail 类型账号（refresh_token
 *     入凭证库，响应不含明文）；
 *  ③ state 防伪：无效 state 明确拒绝；④ 清理。
 * mock Google（token/profile）在脚本内 39998 端口；服务端 GMAIL_*_BASE 已指向 mock。
 * Run: node scripts/verify-gmail.mjs (server :3001 with GMAIL_* env, preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { login, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

let tokenCalls = 0;
let lastForm = "";
const google = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/token") {
    tokenCalls++;
    lastForm = await new Promise((resolve) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => resolve(b));
    });
    res.end(JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }));
    return;
  }
  if (url.pathname === "/gmail/v1/users/me/profile") {
    res.end(JSON.stringify({ emailAddress: "me@example.com", messagesTotal: 1 }));
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => google.listen(39998, "127.0.0.1", r));

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

const apiFetch = (path, options = {}) =>
  page.evaluate(
    async ({ p, o }) => {
      const res = await fetch(p, {
        method: o.method ?? "GET",
        body: o.body,
        credentials: "same-origin",
        headers: o.body ? { "Content-Type": "application/json" } : undefined,
      });
      return { status: res.status, body: await res.text() };
    },
    { p: path, o: options },
  );

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 清理历史绑定 + 重置布局
  await page.evaluate(async () => {
    const accounts = await (await fetch("/api/mail/accounts")).json();
    for (const a of accounts.filter((x) => x.kind === "gmail")) {
      await fetch(`/api/mail/accounts/${a.id}`, { method: "DELETE" });
    }
    const seed = [
      { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
      { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
      { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
      { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
      { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
    ];
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页") ?? list[0]; // 回落首屏：真机/历史库可能没有「首页」（Q82 同款，TST-10）
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // 添加邮件组件 + 打开账号管理
  ok("GMAIL enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("GMAIL add mail widget", await clickBtn("添加组件") && (await sleep(300), await clickBtn("邮件")));
  await sleep(400);
  ok("GMAIL submit widget", await clickBtn("确认添加", true));
  await sleep(1000);
  ok("GMAIL exit edit", await clickBtn("完成编辑"));
  await sleep(300);
  ok("GMAIL open account manager", await clickBtn("数据源管理")); // D42：管理在数据源管理页
  await sleep(500);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "邮箱");
    tab?.click();
  });
  await sleep(300);
  ok("GMAIL expand add-account form", await clickBtn("＋ 添加邮箱")); // Q27b#2 表单按需展开
  await sleep(400);
  await sleep(400);

  // ① OAuth 授权 URL（popup）
  ok("GMAIL click 绑定 Gmail", await clickBtn("绑定 Gmail 账号（OAuth）"));
  const target = await browser
    .waitForTarget((t) => t.opener() === page.target(), { timeout: 8000 })
    .catch(() => null);
  ok("GMAIL authorize popup opened", Boolean(target));
  const authUrl = new URL(target?.url() ?? "");
  ok(
    "GMAIL authorize URL params",
    authUrl.origin === "http://127.0.0.1:39999" &&
      authUrl.searchParams.get("client_id") === "test-client-id" &&
      (authUrl.searchParams.get("scope") ?? "").includes("gmail.readonly") &&
      authUrl.searchParams.get("response_type") === "code" &&
      authUrl.searchParams.get("access_type") === "offline" &&
      Boolean(authUrl.searchParams.get("state")),
    authUrl.toString().slice(0, 160),
  );
  ok(
    "GMAIL redirect_uri is the workbench callback",
    (authUrl.searchParams.get("redirect_uri") ?? "").endsWith("/api/mail/gmail/callback"),
    authUrl.searchParams.get("redirect_uri") ?? "",
  );
  const state = authUrl.searchParams.get("state") ?? "";
  await target?.page().then((p) => p?.close().catch(() => undefined));

  // ② 回调旅程：code → token 交换 → profile → gmail 账号创建
  const cb = await page.evaluate(
    (s) => fetch(`/api/mail/gmail/callback?code=test-code&state=${encodeURIComponent(s)}`).then((r) => r.text()),
    state,
  );
  ok("GMAIL callback binds account", cb.includes("绑定成功") && cb.includes("me@example.com"), cb.slice(0, 120));
  ok("GMAIL token exchanged (authorization_code)", tokenCalls >= 1 && lastForm.includes("grant_type=authorization_code"), `calls=${tokenCalls}`);
  const accounts = JSON.parse((await apiFetch("/api/mail/accounts")).body);
  const gmail = accounts.find((a) => a.kind === "gmail");
  ok(
    "GMAIL account row created (refresh_token via credential ref)",
    Boolean(gmail) && gmail.username === "me@example.com" && Boolean(gmail.credentialId) && !(await apiFetch("/api/mail/accounts")).body.includes("rt-1"),
  );

  // ③ state 防伪
  const bad = await page.evaluate(() =>
    fetch("/api/mail/gmail/callback?code=x&state=invalid-state").then((r) => r.text()),
  );
  ok("GMAIL invalid state rejected", bad.includes("state 无效"), bad.slice(0, 100));

  // ④ 清理
  if (gmail) {
    await apiFetch(`/api/mail/accounts/${gmail.id}`, { method: "DELETE" });
  }
  const after = JSON.parse((await apiFetch("/api/mail/accounts")).body);
  ok("GMAIL cleanup", !after.some((a) => a.kind === "gmail"));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
google.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
