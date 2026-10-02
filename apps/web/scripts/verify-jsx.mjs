/**
 * JSX acceptance (Q10 受限 JSX 模板 · D35 Homarr 模式):
 *  ① 正常模板：白名单组件（Stack/Title/Text/Progress/Badge）+ data 绑定 + 安全子集
 *     （Math.round）+ 三元条件 → 渲染正确；
 *  ② 恶意模板（事件处理器 / 危险标识符 / 非白名单组件 / javascript: href）→
 *     显式"模板错误"提示，不白屏、不执行。
 * mock 上游 API 在脚本内起 HTTP 服务。
 * Run: node scripts/verify-jsx.mjs (server :3000, preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { login, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）
const uniq = Date.now().toString(36).slice(-4);

const upstream = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ title: `jsx-ok-${uniq}`, cpu: 23.4, items: [{ name: "first" }] }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${upstream.address().port}/metrics`;

const goodTemplate = [
  "<Stack>",
  `<Title>{data.title}</Title>`,
  "<Text>{Math.round(data.cpu)}% · {data.items[0].name}</Text>",
  '<Progress value={data.cpu} label="CPU" />',
  "{data.items.length > 0 ? <Badge>有数据</Badge> : <Badge>空</Badge>}",
  '<Anchor href="https://example.com/doc">文档</Anchor>',
  "</Stack>",
].join("");

const badTemplate = `<Text onClick="alert(1)">{window.location}</Text>`;

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

const addJsxWidget = async (template) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn("自定义 API"))) return false;
  await sleep(400);
  if (!(await setField("接口地址", apiUrl))) return false;
  if (!(await selectOption("展示模板", "受限 JSX"))) return false;
  if (!(await setField("受限 JSX 模板", template))) return false;
  await sleep(200);
  return clickBtn("确认添加", true);
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
// TST-19（Q97b）：测前快照布局 —— 跑完还原，不把测试卡片留在真机盘上
await installLayoutGuard(page);

  // 前置：重置首页布局
  await page.evaluate(async () => {
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

  // ① 正常模板
  ok("JSX enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("JSX add widget with template", await addJsxWidget(goodTemplate));
  await sleep(2500);
  const body = await page.evaluate(() => document.body.textContent ?? "");
  ok("JSX title binding renders", body.includes(`jsx-ok-${uniq}`), body.slice(-140));
  ok("JSX safe helpers (Math.round) + member binding", body.includes("23%") && body.includes("first"));
  ok("JSX ternary condition renders element", body.includes("有数据"));
  ok("JSX whitelisted components (Progress/Anchor)", await page.evaluate(() => ({
    progress: document.querySelectorAll(".mantine-Progress-root").length >= 1,
    anchor: [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "https://example.com/doc"),
  })).then((r) => r.progress && r.anchor));

  // ② 恶意模板 → 显式报错
  ok("JSX add widget with malicious template", await addJsxWidget(badTemplate));
  await sleep(2500);
  const body2 = await page.evaluate(() => document.body.textContent ?? "");
  ok("JSX malicious template rejected with visible error", body2.includes("模板错误") && body2.includes("D35"), body2.slice(-160));
  ok(
    "JSX malicious template not executed / not rendered",
    !body2.includes("alert(1)") && page.url().startsWith(WEB),
    page.url(),
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
upstream.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
