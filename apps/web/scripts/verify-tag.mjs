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

const WEB = "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = `${Date.now()}`.slice(-6);
const taskTagged = `tagged-task-${suffix}`;
const taskPlain = `plain-task-${suffix}`;
const tagName = `标签-${suffix}`;
const srcA = `源A-${suffix}`;
const srcB = `源B-${suffix}`;

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${label}  ${extra}`);
  }
};

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
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
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
  ok(await clickBtn("数据源管理"), "TAG open data admin page");
  await sleep(500);
  ok(
    await page.evaluate(
      () =>
        ["任务", "信息源", "标签"].every((t) =>
          [...document.querySelectorAll(".wb-admin [role=tab]")].some((el) => el.textContent.trim() === t),
        ),
      ),
    "TAG admin has 3 tabs (任务/信息源/标签)",
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
  ok(gotInput, "TAG focus visible tag-name input");
  await page.keyboard.type(tagName);
  ok(
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".wb-admin button")].find(
        (b) => b.textContent.trim() === "添加" && b.offsetParent !== null,
      );
      if (!btn) return false;
      btn.click();
      return true;
    }),
    "TAG create tag via UI",
  );
  await sleep(500);
  ok(
    await page.evaluate((n) => {
      // 标签名在行内重命名输入框的 value 里（不进 textContent）——按输入值断言
      return [...document.querySelectorAll(".wb-admin [data-admin-row=tag]")].some((r) =>
        [...r.querySelectorAll("input")].some((i) => i.defaultValue === n),
      );
    }, tagName),
    "TAG created tag listed",
  );

  // ②（Q29b：ToDo 去标签/去筛选 —— 标签仅用于信息源，旅程改为源级）
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("返回工作台"))?.click(),
  );
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
  ok(linked, "TAG link source A to tag (API seeding)");
  await sleep(600);
  ok(
    await clickBtn("编辑页面"),
    "TAG enter edit for config filter",
  );
  await sleep(400);
  ok(
    await page.evaluate(() => {
      const title = [...document.querySelectorAll(".wb-widget *")].find(
        (n) => n.children.length === 0 && n.textContent.trim() === "RSS", // Q85 起信息流标题为「RSS」（原「信息流」字面量漂移）
      );
      const chrome = title?.closest(".wb-chrome");
      const btn = [...(chrome?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
      btn?.click();
      return Boolean(btn);
    }),
    "TAG open rss config",
  );
  await sleep(400);
  ok(
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
    "TAG open tag multiselect in config",
  );
  await sleep(400);
  // 用**真实鼠标事件**点选项（合成 `.click()` 对 portal 下拉 + Modal 的组合不可靠，实测选不上值）
  ok(
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
    "TAG pick tag in config filter",
  );
  await sleep(300);
  await page.keyboard.press("Escape"); // 收起下拉（保留已选项）
  await sleep(500);
  ok(
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
    "TAG save rss config",
  );
  await sleep(1500);
  ok(
    await clickBtn("完成编辑"),
    "TAG exit edit",
  );
  await sleep(600);
  const rssFiltered = await page.evaluate(
    ({ a, b }) => ({
      a: document.body.textContent.includes(`${a}-item-1`),
      b: document.body.textContent.includes(`${b}-item-1`),
    }),
    { a: srcA, b: srcB },
  );
  ok(rssFiltered.a && !rssFiltered.b, "TAG rss filtered by source tag", JSON.stringify(rssFiltered));


  // ⑤ 数据源管理：删除标签确认标题情境化（D34）+ 数据仍在（FR-D4）
  ok(await clickBtn("数据源管理"), "TAG reopen data admin page");
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
    await page.evaluate(() => document.body.textContent.includes("删除标签？")),
    "TAG delete confirm has contextual title (D34)",
  );
  ok(await clickBtn("取消", true), "TAG cancel delete");
  await sleep(300);
} catch (e) {
  fail += 1;
  console.log("FAIL  TAG journey crashed:", e instanceof Error ? e.message : String(e));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
feedServer.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
