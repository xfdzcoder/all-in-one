/**
 * MAIL acceptance (Q7b 邮件组件 UI): 账号管理（口令入凭证库 SEC3）→ 聚合列表 →
 * 多账号错误展示 → 正文沙箱渲染（D30/D25：脚本/远程图被禁，不可信 HTML 零执行）。
 * 说明：`/api/mail/messages*` 由脚本侧请求拦截返回夹具（IMAP 协议路径由服务层
 * 单测的假客户端覆盖，见 apps/server/src/mail/mail.test.ts）；账号 CRUD 走真实服务。
 * Run: node scripts/verify-mail.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-4);

const listFixture = {
  items: [
    {
      uid: 101,
      subject: `周报汇总-${uniq}`,
      from: "boss@example.com",
      date: "2026-09-30T09:00:00.000Z",
      seen: false,
      accountId: "acc-1",
      accountName: "测试邮箱",
    },
    {
      uid: 102,
      subject: `欢迎订阅-${uniq}`,
      from: "news@example.com",
      date: "2026-09-29T09:00:00.000Z",
      seen: true,
      accountId: "acc-1",
      accountName: "测试邮箱",
    },
  ],
  errors: [{ accountId: "acc-2", accountName: "挂掉的邮箱", error: "connection refused" }],
};

const bodyFixture = {
  ...listFixture.items[0],
  text: "纯文本回退",
  html: `<p>富文本<b>正文-${uniq}</b></p><script>window.__PWNED = 1; document.title = "PWNED";</script><img src="https://evil.example/px.gif">`,
};

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

const apiFetch = (path) =>
  page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: "same-origin" });
    return { status: res.status, body: await res.text() };
  }, path);

/** 弹窗内的精确按钮点击（严禁全文档 includes 匹配破坏性按钮 —— 会误点"删除此页"等）。 */
const clickInModal = (label) =>
  page.evaluate((l) => {
    for (const root of document.querySelectorAll(".mantine-Modal-root")) {
      const btn = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === l);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }, label);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 前置：重置首页布局（组件累积会干扰定位），并清掉本脚本的历史账号
  await page.evaluate(async () => {
    const seed = [
      { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
      { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
      { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
      { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
      { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
    ];
    const dashboards = await (await fetch("/api/dashboards")).json();
    const home = dashboards.find((d) => d.title === "首页");
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
    const accounts = await (await fetch("/api/mail/accounts")).json();
    for (const a of accounts.filter((x) => x.name === "测试邮箱")) {
      await fetch(`/api/mail/accounts/${a.id}`, { method: "DELETE" });
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // 添加邮件组件
  ok("MAIL enter edit", await clickBtn("编辑布局"));
  await sleep(300);
  ok("MAIL open picker", await clickBtn("添加组件"));
  await sleep(300);
  ok("MAIL pick 邮件", await clickBtn("邮件"));
  await sleep(400);
  ok("MAIL add mail widget", await clickBtn("确认添加", true));
  await sleep(800);
  ok(
    "MAIL empty state hint",
    await page.evaluate(() => (document.body.textContent ?? "").includes("先在「管理账号」添加邮箱账号")),
  );

  // 账号管理（口令 → 凭证库）
  ok("MAIL open account manager", await clickBtn("管理账号"));
  await sleep(400);
  ok("MAIL fill account name", await setField("名称", "测试邮箱"));
  ok("MAIL fill server", await setField("服务器", "imap.example.com"));
  ok("MAIL fill username", await setField("用户名", `user-${uniq}@example.com`));
  ok("MAIL fill password", await setField("口令/应用专用密码", "sk-mail-pass"));
  await sleep(200);
  ok("MAIL add account", await clickBtn("添加账号"));
  await sleep(800);
  const managerText = await page.evaluate(() => document.body.textContent ?? "");
  ok("MAIL account listed in manager", managerText.includes("测试邮箱") && managerText.includes("imap.example.com"));

  const accountsRes = await apiFetch("/api/mail/accounts");
  const accounts = JSON.parse(accountsRes.body);
  ok(
    "MAIL account stores credential reference only (SEC3)",
    accounts.some((a) => a.name === "测试邮箱" && a.credentialId) && !accountsRes.body.includes("sk-mail-pass"),
    accountsRes.body.slice(0, 120),
  );

  // 消息 API 用夹具拦截（IMAP 路径由服务层单测覆盖）
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/mail/messages/") && /\/\d+$/.test(url)) {
      void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(bodyFixture) });
    } else if (url.includes("/api/mail/messages")) {
      void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(listFixture) });
    } else {
      void req.continue();
    }
  });
  // 关闭管理弹窗（Esc）→ 刷新列表
  await page.keyboard.press("Escape");
  await sleep(300);
  ok("MAIL refresh list", await clickBtn("刷新"));
  await sleep(800);

  const bodyText = await page.evaluate(() => document.body.textContent ?? "");
  ok("MAIL list renders subjects", bodyText.includes(`周报汇总-${uniq}`) && bodyText.includes(`欢迎订阅-${uniq}`));
  ok("MAIL per-account error surfaced", bodyText.includes("挂掉的邮箱") && bodyText.includes("connection refused"));

  // 打开正文 → 沙箱渲染（脚本零执行）
  ok(
    "MAIL open message",
    await page.evaluate((t) => {
      const card = [...document.querySelectorAll(".mantine-Card-root")].find((c) => c.textContent.includes(t));
      if (!card) return false;
      card.click();
      return true;
    }, `周报汇总-${uniq}`),
  );
  await sleep(1000);
  const frameInfo = await page.evaluate(() => {
    const f = [...document.querySelectorAll("iframe[title^='mail-']")][0];
    return f ? { sandbox: f.getAttribute("sandbox"), srcdoc: (f.getAttribute("srcdoc") ?? "").slice(0, 200) } : null;
  });
  ok("MAIL body rendered in sandboxed iframe", Boolean(frameInfo), JSON.stringify(frameInfo)?.slice(0, 120));
  ok("MAIL sandbox = deny-all + CSP", frameInfo?.sandbox === "" && frameInfo?.srcdoc.includes("script-src 'none'"), String(frameInfo?.sandbox));

  let mailFrame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  for (let i = 0; i < 15 && !mailFrame; i++) {
    await sleep(300);
    mailFrame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  }
  const frameState = await mailFrame?.evaluate(() => ({
    pwned: typeof window.__PWNED,
    title: document.title,
    text: document.body.textContent ?? "",
  }));
  ok(
    "MAIL untrusted HTML scripts never execute",
    frameState?.pwned === "undefined" && frameState?.title !== "PWNED",
    JSON.stringify(frameState)?.slice(0, 120),
  );
  ok("MAIL rich text content visible", (frameState?.text ?? "").includes(`正文-${uniq}`));

  // 返回列表 + 清理
  ok("MAIL back to list", await clickBtn("← 返回"));
  await sleep(400);
  ok("MAIL reopen manager for cleanup", await clickBtn("管理账号"));
  await sleep(400);
  ok("MAIL delete account", await clickInModal("删除"));
  await sleep(1200);
  const afterAccounts = JSON.parse((await apiFetch("/api/mail/accounts")).body);
  ok(
    "MAIL account deleted",
    !afterAccounts.some((a) => a.name === "测试邮箱"),
    JSON.stringify(afterAccounts.map((a) => ({ name: a.name, host: a.host }))).slice(0, 160),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200) + " @" + String(e.stack ?? "").split("\n").slice(0, 3).join(" | "));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
