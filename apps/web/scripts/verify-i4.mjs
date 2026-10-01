/**
 * I4 acceptance (FR-I4 组件内查看详情（抽屉/弹层）): 四个声明 detail 的组件 ——
 *  ① 信息流：条目点击 → 弹层（标题/来源/摘要沙箱渲染、脚本零执行、阅读原文链接）；
 *  ② Todo：任务点击 → 弹层（标题/清单/状态/时间）；
 *  ③ 自定义 API：「详情」→ 完整响应 JSON（超出模板展示的部分可见）；
 *  ④ OpenCode：会话点击 → 弹层（ID/创建/更新/耗时）。
 * 数据通道响应用请求拦截夹具（同 verify-mail 模式；组件行为是验证对象）。
 * Run: node scripts/verify-i4.mjs (server :3000, preview :4173)
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

const rssItem = {
  title: `I4 条目-${uniq}`,
  link: "https://example.com/i4-article",
  summary: `<b>富文本摘要-${uniq}</b><script>window.__PWNED = 1;</script>`,
  date: "2026-09-30T09:00:00.000Z",
  itemKey: `k-${uniq}`,
  sourceTitle: "源A",
  read: false,
};
const rssFixture = { items: [rssItem], unread: 1, sourceCount: 1, errors: [] };
const apiFixture = { marker: `i4-full-response-${uniq}`, nested: { a: 1 } };
const opcFixture = {
  probe: { ok: true, version: "9.9.9-test" },
  sessions: [{ id: `s-i4-${uniq}`, title: `会话-${uniq}`, createdAt: 1000, updatedAt: 65000, durationMs: 64000 }],
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
      const proto =
        target.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
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

// Q42：连接信息在「数据源管理 · 数据连接」维护（数据通道被夹具拦截，url 仅占位）
const createOpencodeSource = (name, url) =>
  page.evaluate(
    async ({ name, url }) => {
      const res = await fetch("/api/data-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "opencode", name, config: { url } }),
      });
      return res.ok;
    },
    { name, url },
  );

const clickInWidget = (marker, label) =>
  page.evaluate(
    ({ m, l }) => {
      const item = [...document.querySelectorAll(".grid-stack-item")].find((i) => (i.textContent ?? "").includes(m));
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === l);
      if (!btn) return false;
      btn.click();
      return true;
    },
    { m: marker, l: label },
  );

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 数据通道夹具（按 type 分发）——从一开始就拦截
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/widgets/data")) {
      let type = "";
      try {
        type = JSON.parse(req.postData() ?? "{}").type ?? "";
      } catch {
        /* ignore */
      }
      const payload = type === "rss" ? rssFixture : type === "opencode" ? opcFixture : apiFixture;
      void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ data: payload }) });
    } else {
      void req.continue();
    }
  });

  // 前置：重置首页布局（seed 含 Todo + 信息流）并建一条真实任务
  await page.evaluate(async () => {
    const seed = [
      { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
      { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
      { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
      { id: "seed-4", x: 0, y: 3, w: 6, h: 4, component: "todo", props: { list: "inbox", filter: "all" } },
      { id: "seed-5", x: 6, y: 3, w: 6, h: 4, component: "rss", props: { limit: 10, filter: "all" } },
    ];
    const list = await (await fetch("/api/dashboards")).json();
    const home = list.find((d) => d.title === "首页");
    await fetch(`/api/dashboards/${home.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
    });
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "i4-task-UNIQ", list: "inbox" }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(800);

  // ① 信息流行点击 = 新标签打开原文 + 标已读（Q29c/二.2：无详情弹层）
  await page.evaluate(() => {
    // 拦截 window.open 记录目标（无头环境不真开标签）；记录标已读请求
    (window).__opened = null;
    window.__readPosts = [];
    window.open = (u) => {
      (window).__opened = u;
      return null;
    };
    const of = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/feeds/read")) {
        try {
          window.__readPosts.push(JSON.parse(init?.body ?? "{}"));
        } catch {
          /* noop */
        }
      }
      return of(input, init);
    };
  });
  const beforeUnread = await page.evaluate(() => {
    const badge = [...document.querySelectorAll(".wb-widget .mantine-Badge-root")].find((b) => b.textContent.includes("未读"));
    return badge?.textContent ?? "";
  });
  ok(
    "I4 rss item click opens original in new tab",
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll(".grid-stack-item *")].find(
        (n) => n.children.length === 0 && (n.textContent ?? "").includes(t),
      );
      if (!el) return false;
      el.click();
      return (window).__opened === "https://example.com/i4-article";
    }, `I4 条目-${uniq}`),
  );
  await sleep(800);
  ok(
    "I4 rss item marked read on open",
    await page.evaluate((k) => (window.__readPosts ?? []).some((p) => p.itemKey === k), `k-${uniq}`),
  );
  await sleep(400);

  // ② Todo 详情
  ok(
    "I4 todo opens detail modal",
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".grid-stack-item *")].find(
        (n) => n.children.length === 0 && (n.textContent ?? "").includes("i4-task-UNIQ"),
      );
      if (!el) return false;
      el.click();
      return true;
    }),
  );
  await sleep(600);
  const bodyAfterTodo = await page.evaluate(() => document.body.textContent ?? "");
  ok("I4 todo detail shows list/status/time", bodyAfterTodo.includes("任务详情") && bodyAfterTodo.includes("分组：inbox") && bodyAfterTodo.includes("创建"), bodyAfterTodo.slice(-120));
  await page.keyboard.press("Escape");
  await sleep(400);

  // ③ 自定义 API 详情（完整响应）
  const srcName = `I4 OC 源-${uniq}`;
  ok("I4 create opencode data source", await createOpencodeSource(srcName, "http://fixture.local"));
  ok("I4 enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  // Q34/Q41：编辑态隐藏「未读」徽标（与外框「配置/移除」重叠被遮挡；Q41 起随头部动作簇统一 CSS 隐藏）
  ok(
    "I4 unread badge hidden in edit mode",
    await page.evaluate(() => ![...document.querySelectorAll(".wb-widget .mantine-Badge-root")].some((b) => b.offsetParent !== null && getComputedStyle(b).visibility !== "hidden" && b.textContent.includes("未读"))),
  );
  ok("I4 add custom-api", await clickBtn("添加组件"));
  await sleep(300);
  ok("I4 pick custom-api", await clickBtn("自定义 API"));
  await sleep(400);
  ok("I4 custom-api url", await setField("接口地址", "http://fixture.local/api"));
  await sleep(200);
  ok("I4 custom-api submit", await clickBtn("确认添加", true));
  await sleep(1500);
  ok("I4 add opencode", await clickBtn("添加组件"));
  await sleep(300);
  ok("I4 pick opencode", await clickBtn("OpenCode"));
  await sleep(400);
  // Q42：组件表单只做选择 —— 连接信息（服务地址/访问令牌）不再重填
  ok(
    "I4 opencode form has no connection fields",
    await page.evaluate(() =>
      ![...document.querySelectorAll(".mantine-Modal-root label")].some(
        (l) => l.textContent.includes("服务地址") || l.textContent.includes("访问令牌"),
      ),
    ),
  );
  ok("I4 opencode pick source", await selectOption("数据连接", srcName));
  await sleep(200);
  ok("I4 opencode submit", await clickBtn("确认添加", true));
  await sleep(1500);
  ok("I4 exit edit", await clickBtn("完成编辑"));
  await sleep(400);
  // Q34/Q41：退出编辑后徽标恢复
  ok(
    "I4 unread badge restored in browse mode",
    await page.evaluate(() => [...document.querySelectorAll(".wb-widget .mantine-Badge-root")].some((b) => b.offsetParent !== null && getComputedStyle(b).visibility !== "hidden" && b.textContent.includes("未读"))),
  );
  await sleep(400);

  ok("I4 custom-api detail opens", await clickInWidget("自定义 API", "详情"));
  await sleep(600);
  const bodyAfterApi = await page.evaluate(() => document.body.textContent ?? "");
  ok("I4 custom-api detail shows full response", bodyAfterApi.includes(`i4-full-response-${uniq}`), bodyAfterApi.slice(-120));
  await page.keyboard.press("Escape");
  await sleep(400);

  // ④ OpenCode 会话详情
  ok(
    "I4 opencode session opens detail",
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll(".grid-stack-item *")].find(
        (n) => n.children.length === 0 && (n.textContent ?? "").includes(t),
      );
      if (!el) return false;
      el.click();
      return true;
    }, `会话-${uniq}`),
  );
  await sleep(600);
  const bodyAfterOpc = await page.evaluate(() => document.body.textContent ?? "");
  ok(
    "I4 opencode detail shows id/duration",
    bodyAfterOpc.includes("会话详情") && bodyAfterOpc.includes(`s-i4-${uniq}`) && bodyAfterOpc.includes("1 分"),
    bodyAfterOpc.slice(-120),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
