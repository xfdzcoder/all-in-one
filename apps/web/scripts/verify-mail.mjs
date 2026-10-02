/**
 * MAIL acceptance (Q7b 邮件组件 UI): 账号管理（口令入凭证库 SEC3）→ 聚合列表 →
 * 多账号错误展示 → 正文沙箱渲染（D30/D25：脚本/远程图被禁，不可信 HTML 零执行）。
 * 说明：`/api/mail/messages*` 由脚本侧请求拦截返回夹具（IMAP 协议路径由服务层
 * 单测的假客户端覆盖，见 apps/server/src/mail/mail.test.ts）；账号 CRUD 走真实服务。
 * Run: node scripts/verify-mail.mjs (server :3000, preview :4173)
 *
 * **TST-23**（用户反馈②）：全程使用临时草稿盘（`tmp-verify-*` 自建自删），
 * `?page=<id>` 深链定位 —— 不回落 `list[0]`，用户页面（「用户页面禁止修改」）零接触。
 */
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { backToWorkspace, createScratchDashboard, deleteScratchDashboard, login, makeApiFetch, makeClickBtn, makeOk, openSettings, sleep, uniqId } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）
const uniq = uniqId(); // TST-8：时间戳+随机，防同毫秒重名/残留互撞

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

/** D64（用户反馈③）：已读端点命中记账（夹具同步 seen，验「未读标记取消」全链路）。 */
const readMarks = [];

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
// 诊断：渲染崩溃（如组件整树 throw）会静默吃掉断言 —— 收集 pageerror 供排查
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));
await page.setViewport({ width: 1400, height: 900 });
let listCalls = 0;

const clickBtn = makeClickBtn(page); // TST-12/14：精确优先匹配（首个命中陷阱消解）

const setField = (label, value) =>
  page.evaluate(
    ({ l, v }) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root, .wb-admin .mantine-InputWrapper-root")].find((w) =>
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
const api = makeApiFetch(page); // TST-23：带 method 的同源 fetch（建/删草稿盘用）
let scratch = null; // TST-23：本轮临时草稿盘（收尾自删）

/** TST-24（真事故，2026-10-02）：删除**只准按行名锚定**「测试邮箱」行内的按钮。
 *  原 `clickInModal("删除")` 命中列表首个删除按钮 —— 用户真实账号排前面时被误删
 *  （实测误删过用户的 qq 邮箱，靠 WAL 里的凭证密文才找回来）。确认弹窗同样按名锚定。 */
const deleteOwnAccountRow = (name) =>
  page.evaluate((n) => {
    const rows = [...document.querySelectorAll(".wb-admin__row")].filter((r) => (r.textContent ?? "").includes(n));
    const btn = rows
      .map((r) => [...r.querySelectorAll("button")].find((b) => b.textContent.trim() === "删除"))
      .find(Boolean);
    if (!btn) return false;
    btn.click();
    return true;
  }, name);

const confirmDeleteOwnAccount = (name) =>
  page.evaluate((n) => {
    for (const root of document.querySelectorAll(".mantine-Modal-root")) {
      if (root.offsetParent === null) continue;
      if (!(root.textContent ?? "").includes(`确认删除邮件账号「${n}」`)) continue;
      const btn = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === "确认");
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }, name);

/** D64（用户反馈③）：某封邮件行的未读状态（蓝点 badge + 主题字重）。 */
const mailRowState = (subject) =>
  page.evaluate((s) => {
    const row = [...document.querySelectorAll(".wb-mail-row")].find((c) => (c.textContent ?? "").includes(s));
    if (!row) return null;
    const badge = Boolean(row.querySelector(".mantine-Badge-root"));
    const subjectNode = [...row.querySelectorAll("*")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").includes(s),
    );
    return { badge, fw: subjectNode ? getComputedStyle(subjectNode).fontWeight : "400" };
  }, subject);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // TST-23：组件挂在**自建临时草稿盘**上（不再重置任何既有页面 —— 用户页面零接触）；
  // 顺手清掉本脚本的历史账号（数据实体，与页面无关）
  scratch = await createScratchDashboard(api);
  const seed = [
    { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
    { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
    { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
    { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
    { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
  ];
  const put = await api(`/api/dashboards/${scratch.id}/layout`, {
    method: "PUT",
    body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
  });
  if (put.status !== 200) throw new Error(`草稿盘布局写入失败：HTTP ${put.status} ${put.body}`);
  await page.evaluate(async () => {
    const accounts = await (await fetch("/api/mail/accounts")).json();
    for (const a of accounts.filter((x) => x.name === "测试邮箱")) {
      await fetch(`/api/mail/accounts/${a.id}`, { method: "DELETE" });
    }
  });
  // 深链定位草稿盘（`?page=` 优先于 rows[0]；后续 reload 停留在草稿盘）
  await page.goto(`${WEB}?page=${scratch.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // 消息 API 用夹具拦截（IMAP 路径由服务层单测覆盖）——从一开始就拦截：
  // 真实 IMAP 尝试又慢又会在迟到时覆盖夹具结果（retry 与查询竞态）
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/mail/messages/") && url.endsWith("/read")) {
      // D64：本地已读标记端点 —— 记账 + 把夹具标已读（列表响应随之反映徽标消失）
      const m = /\/api\/mail\/messages\/([^/]+)\/([^/]+)\/read/.exec(url);
      if (m) {
        for (const it of listFixture.items) {
          if (String(it.accountId) === m[1] && String(it.uid) === m[2]) it.seen = true;
        }
        readMarks.push(`${m[1]}:${m[2]}`);
      }
      void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    } else if (url.includes("/api/mail/messages/") && /\/\d+$/.test(url)) {
      void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(bodyFixture) });
    } else if (url.includes("/api/mail/messages")) {
      // 首次返回空列表（空态提示可断言），此后返回夹具
      listCalls += 1;
      const payload = listCalls === 1 ? { items: [], errors: [] } : listFixture;
      void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    } else {
      void req.continue();
    }
  });
  // 添加邮件组件
  ok("MAIL enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("MAIL open picker", await clickBtn("添加组件"));
  await sleep(300);
  ok("MAIL pick 邮件", await clickBtn("邮件"));
  await sleep(400);
  ok("MAIL add mail widget", await clickBtn("确认添加", true));
  await sleep(800);
  ok(
    "MAIL empty state hint",
    await page.evaluate(() => {
      const t = document.body.textContent ?? "";
      // 空态两种文案都算达标：无账号 →「先在…添加邮箱账号」；有账号但无邮件 →「暂无邮件」
      // （用户环境里常有真实账号，断言不能只认前一种，否则永远红）
      return t.includes("先在「数据源管理 · 邮箱」添加邮箱账号") || t.includes("暂无邮件");
    }),
  );

  // 编辑态组件内容惰性（FR-P8）：组件内操作在浏览模式进行
  ok("MAIL exit edit to operate widget", await clickBtn("完成编辑"));
  await sleep(400);

  // 账号管理（口令 → 凭证库）—— Q68：卡片内「管理邮箱」按钮已移除，入口统一在头部「数据源管理」
  ok("MAIL open account manager", await openSettings(page, "数据源"));
  await sleep(500);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "邮箱");
    tab?.click();
  });
  await sleep(300);
  // Q27b#2：表单按需展开（列表为主布局）
  ok("MAIL expand add-account form", await clickBtn("＋ 添加邮箱"));
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

  // 返回工作台 → 刷新列表（scoped：页面上其它组件也有「刷新」按钮）
  await backToWorkspace(page);
  await sleep(500);
  ok(
    "MAIL refresh list",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.querySelector(".wb-widget--mail"));
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "刷新");
      if (!btn) return false;
      btn.click();
      return true;
    }),
  );
  await sleep(800);

  const bodyText = await page.evaluate(() => document.body.textContent ?? "");
  ok("MAIL list renders subjects", bodyText.includes(`周报汇总-${uniq}`) && bodyText.includes(`欢迎订阅-${uniq}`));
  ok("MAIL per-account error surfaced", bodyText.includes("挂掉的邮箱") && bodyText.includes("connection refused"));
  // D64 前置：未读信有蓝点 + 加粗（为「点开取消标记」铺垫）
  const unreadBefore = await mailRowState(`周报汇总-${uniq}`);
  ok(
    "MAIL unread row shows badge and bold (D64 前置)",
    Boolean(unreadBefore?.badge) && Number(unreadBefore?.fw) >= 600,
    JSON.stringify(unreadBefore),
  );

  // Q68（项 2）：卡片左上角显示本卡覆盖的邮箱 —— 账号名 `，`连接、**仅一行、超出省略号**；
  // 与 /api/mail/accounts 的 name 清单逐字对齐（校验多账号连接完整）；
  // 同时断言「管理邮箱」按钮确实已移除（管理入口统一在头部「数据源管理」）
  const mailbox = await page.evaluate(async () => {
    const w = document.querySelector(".wb-widget--mail");
    const label = w?.querySelector(".wb-mailbox-label");
    if (!label) return { found: false };
    const cs = getComputedStyle(label);
    const accounts = await (await fetch("/api/mail/accounts")).json();
    return {
      found: true,
      text: label.textContent.trim(),
      expected: (accounts ?? []).map((a) => a.name).filter(Boolean).join("，") || "全部邮箱",
      css: `${cs.whiteSpace}/${cs.textOverflow}/${cs.overflow}`,
      singleLine: cs.whiteSpace === "nowrap" && cs.textOverflow === "ellipsis" && cs.overflow === "hidden",
    };
  });
  ok(
    "MAIL header shows mailbox label, single-line ellipsis (Q68)",
    Boolean(mailbox.found) && mailbox.text === mailbox.expected && mailbox.singleLine,
    JSON.stringify(mailbox),
  );
  ok(
    "MAIL 管理邮箱 button removed (Q68)",
    await page.evaluate(() => {
      const w = document.querySelector(".wb-widget--mail");
      return ![...(w?.querySelectorAll("button") ?? [])].some((b) => (b.textContent ?? "").includes("管理邮箱"));
    }),
  );

  // Q33：配置表单「展示的邮箱」下拉须列账号（dynamic mail-accounts 选项源回归）
  ok("MAIL enter edit for config check", await clickBtn("编辑页面"));
  await sleep(300);
  ok(
    "MAIL open widget config",
    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => i.querySelector(".wb-widget--mail"));
      const chrome = item?.querySelector(".wb-chrome");
      const btn = [...(chrome?.querySelectorAll(".wb-chrome__actions button") ?? [])].find((b) => b.textContent.trim() === "配置");
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(500);
  ok(
    "MAIL open account multiselect in config",
    await page.evaluate(() => {
      const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter((r) => r.offsetParent !== null && r.textContent.trim().length > 0);
      const root = roots[roots.length - 1];
      const wrapper = [...(root?.querySelectorAll(".mantine-InputWrapper-root") ?? [])].find((w) =>
        w.querySelector("label")?.textContent.includes("展示的邮箱"),
      );
      wrapper?.querySelector("input")?.click();
      return Boolean(wrapper);
    }),
  );
  await sleep(400);
  ok(
    "MAIL account listed in config dropdown (Q33)",
    await page.evaluate((n) => [...document.querySelectorAll("[data-combobox-option]")].some((e) => e.offsetParent !== null && e.textContent.includes(n)), "测试邮箱"),
  );
  await page.keyboard.press("Escape");
  await sleep(200);
  ok(
    "MAIL close config",
    await page.evaluate(() => {
      const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter((r) => r.offsetParent !== null && r.textContent.trim().length > 0);
      const root = roots[roots.length - 1];
      const btn = root?.querySelector('[class*="Modal-close"]');
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(300);
  ok("MAIL exit edit after config check", await clickBtn("完成编辑"));
  await sleep(300);

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

  // 返回列表 + 清理（Q68：管理入口在头部「数据源管理」，进去后需自行切到「邮箱」页签）
  ok("MAIL back to list", await clickBtn("← 返回"));
  await sleep(600);
  // D64（用户反馈③）：点开 → 返回列表「未读标记」已取消（蓝点消失 + 常规字重 + 已读端点被调用）
  const readAfter = await mailRowState(`周报汇总-${uniq}`);
  ok(
    "MAIL opening a message clears the unread mark (D64)",
    Boolean(readAfter) && readAfter.badge === false && Number(readAfter.fw) < 600 && readMarks.includes("acc-1:101"),
    JSON.stringify({ row: readAfter, readMarks }),
  );
  ok("MAIL reopen manager for cleanup", await openSettings(page, "数据源"));
  await sleep(500);
  ok(
    "MAIL switch to mailbox tab",
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "邮箱");
      tab?.click();
      return Boolean(tab);
    }),
  );
  await sleep(400);
  // TST-24：按行名锚定只删本脚本的「测试邮箱」—— 首个匹配的「删除」曾误删用户真实账号
  ok("MAIL delete account", await deleteOwnAccountRow("测试邮箱"));
  await sleep(400);
  ok("MAIL delete requires confirm (D31)", await confirmDeleteOwnAccount("测试邮箱"));
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

if (scratch) {
  // TST-23：临时草稿盘自删（失败打印告警供手工清理，不吞测试结论）
  await deleteScratchDashboard(api, scratch.id).catch((e) =>
    console.error("!! 临时草稿盘清理失败，需手工删除：", scratch.id, e?.message ?? e),
  );
}
await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
const failed = results.filter((r) => !r.pass);
if (pageErrors.length > 0) console.error("!! 页面渲染错误（pageerror）：", pageErrors.slice(0, 3));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
