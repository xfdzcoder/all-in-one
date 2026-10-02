/**
 * PL5 acceptance (FR-W5③/FR-W6/FR-W7, D24/D25): code-level plugin end-to-end —
 *  ① 安装：REST 上传 zip（manifest + 入口模块）→ 校验 → 落盘登记；
 *  ② 启用后进入组件选择器（manifest 驱动，与内置组件同路径）；
 *  ③ 沙箱渲染（D25）：iframe sandbox=allow-scripts（不透明源）+ CSP connect-src 'none'
 *     —— 插件渲染自己的配置，但**不能发起任何网络请求**、碰不到宿主存储；
 *  ④ 配置变更经桥传入沙箱（FR-W4 路径）；
 *  ⑤ 卸载清理。
 * Run: node scripts/verify-pl5.mjs (server :3000, preview :4173)
 */
import { strToU8, zipSync } from "fflate";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-4);
const PLUGIN_TYPE = "hello-plugin";

const manifest = {
  type: PLUGIN_TYPE,
  name: "Hello 插件",
  description: "PL5 验收样例（零依赖自包含入口）",
  category: "插件",
  defaultSize: { w: 4, h: 3 },
  configSchema: [{ key: "title", label: "标题", type: "text", default: "pl5" }],
  capabilities: { data: { source: "none" } },
  plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions: { actions: ["hello.ping"] } },
};

const entryCode = `export default function render(props, ctx) {
  const div = document.createElement("div");
  div.textContent = "plugin-hello:" + ((props.config && props.config.title) || "");
  ctx.root.replaceChildren(div);
}`;

const packageBase64 = Buffer.from(
  zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "widget.js": strToU8(entryCode),
  }),
).toString("base64");

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

/** 同源 fetch（带会话 cookie）——脚本侧走 REST，UI 侧走选择器。 */
const apiFetch = (path, options = {}) =>
  page.evaluate(
    async ({ p, o }) => {
      const res = await fetch(p, {
        method: o.method ?? "GET",
        body: o.body,
        credentials: "same-origin",
        // 无 body 不发 Content-Type（Fastify 空 JSON body 会 400）
        headers: o.body ? { "Content-Type": "application/json" } : undefined,
      });
      return { status: res.status, body: await res.text() };
    },
    { p: path, o: options },
  );

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  // TST-19/Q101c-2c：清历史残留的本脚本测试卡（pl5-*）——失败轮次曾因布局保存 800ms 防抖
  // 盖掉还原而累积；清完重载让网格拿到干净布局，断言才定位到「本轮新加的」卡。
  {
    const list = JSON.parse((await apiFetch("/api/dashboards")).body);
    const home = list.find((d) => d.title === "首页") ?? list[0]; // TST-10：无「首页」回落首屏
    const items = JSON.parse(home.layoutJson ?? "[]");
    const kept = items.filter(
      (it) => !(it.component === "hello-plugin" && String(it.props?.title ?? "").startsWith("pl5-")),
    );
    if (kept.length !== items.length) {
      const put = await apiFetch(`/api/dashboards/${home.id}/layout`, {
        method: "PUT",
        body: JSON.stringify({ layoutJson: JSON.stringify(kept) }), // apiFetch 的 body 传已序列化串
      });
      if (put.status !== 200) throw new Error(`残留清理失败：HTTP ${put.status} ${put.body.slice(0, 120)}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".grid-stack", { timeout: 8000 });
      await sleep(400);
    }
  }
  // TST-19：测前快照布局 —— 跑完还原，不把插件测试卡留在真机盘上
  await installLayoutGuard(page);

  // ① 安装（同名残留先卸载，保证可重复）
  const existing = JSON.parse((await apiFetch("/api/plugins")).body);
  for (const p of existing.filter((x) => x.type === PLUGIN_TYPE)) {
    await apiFetch(`/api/plugins/${p.id}`, { method: "DELETE" });
  }
  const installed = await apiFetch("/api/plugins", {
    method: "POST",
    body: JSON.stringify({ packageBase64 }),
  });
  ok("PL5 install plugin package (REST)", installed.status === 201, `status=${installed.status} ${installed.body.slice(0, 120)}`);
  const pluginId = JSON.parse(installed.body).id;

  const entry = await apiFetch(`/api/plugins/${pluginId}/entry`);
  ok("PL5 entry code served as JSON data (D25 loader input)", entry.status === 200 && entry.body.includes("export default"));

  const enabled = await apiFetch(`/api/plugins/${pluginId}/enable`, { method: "POST" });
  ok(
    "PL5 enable plugin (FR-W6)",
    enabled.status === 200 && JSON.parse(enabled.body).status === "enabled",
    `status=${enabled.status} ${enabled.body.slice(0, 100)}`,
  );

  // 启用后重载，让宿主重取插件清单（Q5d 管理页将直接失效查询缓存）
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);

  // ② 选择器清单动态出现（J8：manifest 驱动，新增组件不改核心）
  ok("PL5 enter edit", await clickBtn("编辑页面"));
  await sleep(300);
  ok("PL5 open picker", await clickBtn("添加组件"));
  await sleep(400);
  const picker = await page.evaluate(() =>
    [...document.querySelectorAll(".mantine-Modal-root button")].map((b) => b.textContent.trim()),
  );
  ok("PL5 plugin listed in picker", picker.some((t) => t.includes("Hello 插件")), picker.join(" | ").slice(0, 120));
  ok("PL5 pick Hello 插件", await clickBtn("Hello 插件"));
  await sleep(400);
  const title = `pl5-${uniq}`;
  ok("PL5 config form from plugin configSchema", await setField("标题", title));
  await sleep(200);
  ok("PL5 add plugin widget", await clickBtn("确认添加", true));
  await sleep(1500);

  // ③ 沙箱渲染（D25）
  const frameEl = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".grid-stack-item")];
    const f = items.map((i) => i.querySelector("iframe[title^='plugin-']")).find(Boolean);
    return f ? { sandbox: f.getAttribute("sandbox"), title: f.getAttribute("title") } : null;
  });
  ok("PL5 widget renders sandboxed iframe", Boolean(frameEl), JSON.stringify(frameEl));
  ok("PL5 sandbox = allow-scripts (opaque origin, no allow-same-origin)", frameEl?.sandbox === "allow-scripts", String(frameEl?.sandbox));

  // 框内渲染结果（puppeteer 可进 srcdoc frame 读 DOM）
  let pluginFrame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  for (let i = 0; i < 20 && !pluginFrame; i++) {
    await sleep(300);
    pluginFrame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  }
  ok("PL5 plugin frame present", Boolean(pluginFrame));
  let rendered = "";
  for (let i = 0; i < 20; i++) {
    rendered = await pluginFrame?.evaluate(() => document.getElementById("root")?.textContent ?? "") ?? "";
    if (rendered.includes(title)) break;
    await sleep(300);
  }
  ok("PL5 plugin renders its config inside sandbox", rendered.includes(`plugin-hello:${title}`), rendered.slice(0, 80));

  const isolation = await pluginFrame?.evaluate(async () => {
    const out = { origin: String(window.origin), storageThrows: false, netBlocked: false };
    try {
      localStorage.setItem("x", "1");
    } catch {
      out.storageThrows = true;
    }
    try {
      // no-cors 请求不被 CORS 拦（能通就说明 CSP 没生效）；connect-src 'none' 应拒绝
      await fetch("http://127.0.0.1:4173/", { mode: "no-cors" });
      out.netBlocked = false;
    } catch {
      out.netBlocked = true;
    }
    return out;
  });
  ok("PL5 opaque origin + no host storage", isolation?.origin === "null" && isolation?.storageThrows === true, JSON.stringify(isolation));
  ok("PL5 CSP blocks all plugin network (connect-src 'none')", isolation?.netBlocked === true);

  // ④ 配置变更经桥传入沙箱（FR-W4）
  const updated = `pl5b-${uniq}`;
  ok("PL5 open plugin config", await page.evaluate(() => {
    const items = [...document.querySelectorAll(".grid-stack-item")];
    const item = items.map((i) => (i.querySelector("iframe[title^='plugin-']") ? i : null)).find(Boolean);
    const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "配置");
    if (!btn) return false;
    btn.click();
    return true;
  }));
  await sleep(400);
  ok("PL5 update config via form", await setField("标题", updated));
  await sleep(200);
  ok("PL5 save config", await clickBtn("保存配置", true));
  let rendered2 = "";
  for (let i = 0; i < 20; i++) {
    rendered2 = await pluginFrame?.evaluate(() => document.getElementById("root")?.textContent ?? "") ?? "";
    if (rendered2.includes(updated)) break;
    await sleep(300);
  }
  ok("PL5 sandbox re-renders on config change (bridge)", rendered2.includes(`plugin-hello:${updated}`), rendered2.slice(0, 80));

  // ⑤ 卸载清理（FR-W6）
  const disabled = await apiFetch(`/api/plugins/${pluginId}/disable`, { method: "POST" });
  ok("PL5 disable plugin (FR-W6)", disabled.status === 200 && JSON.parse(disabled.body).status === "disabled");
  const removed = await apiFetch(`/api/plugins/${pluginId}`, { method: "DELETE" });
  ok("PL5 uninstall plugin", removed.status === 200);
  const gone = await apiFetch(`/api/plugins/${pluginId}/entry`);
  ok("PL5 entry gone after uninstall", gone.status === 404);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

// 测后还原布局（TST-19）：等布局保存防抖落盘后再还原，避免迟到的 PUT 盖掉还原
await sleep(1000);
await restoreLayouts(page).catch(() => {});
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
