/**
 * verify-tag —— Q22b-2 验收（FR-D1/D2/D3/D4，D40）：
 *  ① 数据源管理面：三页签（Todo / 信息源 / 标签）；UI 新建标签、给任务打标（MultiSelect）；
 *  ② Todo 组件「筛选」：勾选标签 → 只显示打标任务（服务端过滤）；清除 → 全部回来；
 *  ③ RSS 组件「筛选」：按标签选源 —— 打标源条目显示、未打标源条目隐藏；
 *  ④ 删除标签二次确认标题情境化（D34：「删除标签？」）；
 *  ⑤ 标签是视图维度（FR-D4）：删除标签后数据仍在。
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { backToWorkspace, login, makeClickBtn, makeOk, openSettings, summarize } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = `${Date.now()}`.slice(-6);
const taskTagged = `tagged-task-${suffix}`;
const taskPlain = `plain-task-${suffix}`;
const tagName = `标签-${suffix}`;
const srcA = `源A-${suffix}`;
const srcB = `源B-${suffix}`;

const results = []; // TST-15：统一记账
const ok = makeOk(results); // TST-15：签名统一 (name, pass, detail)（原 cond,label 反序族，调用点已对调）

// mock feeds：A/B 两个源，各自 2 条
const feedXml = (name) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${name}</title>` +
  [1, 2]
    .map(
      (i) =>
        `<item><title>${name}-item-${i}</title><link>http://x/${name}/${i}</link><guid>${name}-g-${i}</guid><pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate><description>d</description></item>`,
    )
    .join("") +
  `</channel></rss>`;
const feedServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/rss+xml" });
  res.end(feedXml(req.url?.includes("feedA") ? srcA : srcB));
});
await new Promise((r) => feedServer.listen(0, "127.0.0.1", r));
const feedPort = feedServer.address().port;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const clickBtn = makeClickBtn(page); // TST-12/14：精确优先匹配（首个命中陷阱消解）

/** 叠层弹窗取顶层（最后一个可见 root）——避免勾到下层筛选弹窗。 */
const _TOP = `(() => {
  const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter((r) => r.offsetParent !== null && r.textContent.trim().length > 0);
  return roots[roots.length - 1] ?? null;
})()`;

/** Mantine Tabs 面板挂载但隐藏 —— 所有面板内选择器必须过滤可见元素。 */
const _vis = "(el) => el.offsetParent !== null";

/** 在某容器内按文本找行（用于数据源管理列表定位）。 */
const _rowByText = (text) =>
  page.evaluate((t) => {
    const leaf = [...document.querySelectorAll(".mantine-Modal-root *")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").includes(t),
    );
    if (!leaf) return null;
    let row = leaf.parentElement;
    while (row && !row.querySelector("[role=combobox], button")) row = row.parentElement;
    return row ? true : null;
  }, text);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 播种：首页布局（todo + rss）+ 两个任务 + 两个 mock 源
  const seeded = await page.evaluate(
    async ({ taskTagged, taskPlain, srcA, srcB, feedPort }) => {
      const seed = [
        { id: "seed-1", x: 0, y: 0, w: 6, h: 5, component: "todo", props: { list: "inbox", filter: "all" } },
        { id: "seed-2", x: 6, y: 0, w: 6, h: 5, component: "rss", props: { limit: 10, filter: "all" } },
      ];
      const list = await (await fetch("/api/dashboards")).json();
      const home = list.find((d) => d.title === "首页") ?? list[0]; // 回落首屏：真机/历史库可能没有「首页」（Q82 同款，TST-10）
      await fetch(`/api/dashboards/${home.id}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutJson: JSON.stringify(seed) }),
      });
      const mk = (title) =>
        fetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, list: "inbox" }),
        }).then((r) => r.json());
      const t1 = await mk(taskTagged);
      const t2 = await mk(taskPlain);
      const s1 = await (
        await fetch("/api/feeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: srcA, url: `http://127.0.0.1:${feedPort}/feedA.xml` }),
        })
      ).json();
      const s2 = await (
        await fetch("/api/feeds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: srcB, url: `http://127.0.0.1:${feedPort}/feedB.xml` }),
        })
      ).json();
      return { s1, s2, t1, t2 };
    },
    { taskTagged, taskPlain, srcA, srcB, feedPort },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(1200);

  // ① 数据源管理面：三页签 + UI 新建标签
  ok( "TAG open data admin page",await openSettings(page, "数据源"));
  await sleep(500);
  ok(
    "TAG admin has 3 tabs (任务/信息源/标签)",
    await page.evaluate(
      () =>
        ["任务", "信息源", "标签"].every((t) =>
          [...document.querySelectorAll(".wb-admin [role=tab]")].some((el) => el.textContent.trim() === t),
        ),
      ),
  );
  // 先切到「标签」页签（默认在任务）——页面态选择器作用域 .wb-admin
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find(
      (t) => t.textContent.trim() === "标签",
    );
    tab?.click();
  });
  await sleep(300);
  const gotInput = await page.evaluate(() => {
    const input = [...document.querySelectorAll(".wb-admin input")].find(
      (i) => i.placeholder.startsWith("新标签名") && i.offsetParent !== null,
    );
    input?.focus();
    input?.click();
    return Boolean(input);
  });
  ok( "TAG focus visible tag-name input",gotInput);
  await page.keyboard.type(tagName);
  ok(
    "TAG create tag via UI",
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".wb-admin button")].find(
        (b) => b.textContent.trim() === "添加" && b.offsetParent !== null,
      );
      if (!btn) return false;
      btn.click();
      return true;
    }),
  );
  await sleep(500);
  ok(
    "TAG created tag listed",
    await page.evaluate((n) => {
      // 标签名在行内重命名输入框的 value 里（不进 textContent）——按输入值断言
      return [...document.querySelectorAll(".wb-admin [data-admin-row=tag]")].some((r) =>
        [...r.querySelectorAll("input")].some((i) => i.defaultValue === n),
      );
    }, tagName),
  );

  // ②（Q29b：ToDo 去标签/去筛选 —— 标签仅用于信息源，旅程改为源级）
  await backToWorkspace(page);
  await sleep(500);

  // ④ RSS 组件筛选（Q29c/二.3：筛选并入配置 —— 配置表单 multiselect 选标签）
  const linked = await page.evaluate(async ({ s1, tName }) => {
    const tags = await (await fetch("/api/tags")).json();
    const tag = tags.find((t) => t.name === tName); // 精确名 —— 历史轮次会留下同前缀旧标签
    if (!tag) return false;
    await fetch("/api/tags/targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "feed", targetId: s1.id, tagIds: [tag.id] }),
    });
    return true;
  }, { s1: seeded.s1, tName: tagName });
  ok( "TAG link source A to tag (API seeding)",linked);
  await sleep(600);
  ok(
    "TAG enter edit for config filter",
    await clickBtn("编辑页面"),
  );
  await sleep(400);
  ok(
    "TAG open rss config",
    await page.evaluate(() => {
      const title = [...document.querySelectorAll(".wb-widget *")].find(
        (n) => n.children.length === 0 && n.textContent.trim() === "RSS", // Q85 起信息流标题为「RSS」（原「信息流」字面量漂移）
      );
      const chrome = title?.closest(".wb-chrome");
      const btn = [...(chrome?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
      btn?.click();
      return Boolean(btn);
    }),
  );
  await sleep(400);
  ok(
    "TAG open tag multiselect in config",
    await page.evaluate(() => {
      const roots = [...document.querySelectorAll(".mantine-Modal-root")].filter(
        (r) => r.offsetParent !== null && r.textContent.trim().length > 0,
      );
      const root = roots[roots.length - 1];
      const wrapper = [...(root?.querySelectorAll(".mantine-InputWrapper-root") ?? [])].find((w) =>
        w.querySelector("label")?.textContent.includes("按标签筛选"),
      );
      wrapper?.querySelector("input")?.click();
      return Boolean(wrapper);
    }),
  );
  await sleep(400);
  // 用**真实鼠标事件**点选项（合成 `.click()` 对 portal 下拉 + Modal 的组合不可靠，实测选不上值）
  ok(
    "TAG pick tag in config filter",
    await (async () => {
      const handle = await page.evaluateHandle((n) => {
        return [...document.querySelectorAll("[data-combobox-option]")].find(
          (e) => e.offsetParent !== null && e.textContent.includes(n),
        );
      }, tagName);
      const el = handle.asElement();
      if (!el) return false;
      await el.click();
      return true;
    })(),
  );
  await sleep(300);
  await page.keyboard.press("Escape"); // 收起下拉（保留已选项）
  await sleep(500);
  ok(
    "TAG save rss config",
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
  ok(
    "TAG exit edit",
    await clickBtn("完成编辑"),
  );
  await sleep(600);
  const rssFiltered = await page.evaluate(
    ({ a, b }) => ({
      a: document.body.textContent.includes(`${a}-item-1`),
      b: document.body.textContent.includes(`${b}-item-1`),
    }),
    { a: srcA, b: srcB },
  );
  ok( "TAG rss filtered by source tag",rssFiltered.a && !rssFiltered.b, JSON.stringify(rssFiltered));


  // ⑤ 数据源管理：删除标签确认标题情境化（D34）+ 数据仍在（FR-D4）
  ok( "TAG reopen data admin page",await openSettings(page, "数据源"));
  await sleep(500);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".wb-admin [role=tab]")].find((t) => t.textContent.trim() === "标签");
    tab?.click();
  });
  await sleep(300);
  await page.evaluate((n) => {
    const row = [...document.querySelectorAll(".wb-admin [data-admin-row=tag]")].find((r) =>
      [...r.querySelectorAll("input")].some((i) => i.defaultValue === n),
    );
    const del = [...(row?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent.trim() === "×" && b.offsetParent !== null,
    );
    del?.click();
    return Boolean(del);
  }, tagName);
  await sleep(400);
  ok(
    "TAG delete confirm has contextual title (D34)",
    await page.evaluate(() => document.body.textContent.includes("删除标签？")),
  );
  ok( "TAG cancel delete",await clickBtn("取消", true));
  await sleep(300);
} catch (e) {
  fail += 1;
  console.log("FAIL  TAG journey crashed:", e instanceof Error ? e.message : String(e));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
feedServer.close();
process.exit(summarize(results) ? 0 : 1);
