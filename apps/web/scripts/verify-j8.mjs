/**
 * J8 acceptance: extension mechanism —
 *  ① 插件规范文档（packages/widget-sdk/README.md = 契约规范）；
 *  ② 零代码组件样例（FR-W5② 自定义 API：纯 configSchema 配置 + D14 声明式模板，
 *     不写一行组件代码即可获得新组件视图）；
 *  ③ "新增组件不改核心"：布局宿主 Board.tsx 零组件硬编码（组件只在
 *     widget-registry 注册 manifest + 渲染实现），选择器清单由 builtinManifests
 *     驱动 —— 新增组件不触碰布局引擎/宿主核心。
 * Run: node scripts/verify-j8.mjs (server :3000 with ALLOW_PRIVATE_OUTBOUND=1,
 *      preview :4173)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ① 插件规范文档 -------------------------------------------------------
const specDoc = readFileSync(path.join(ROOT, "packages/widget-sdk/README.md"), "utf8");
const specAnchors = [
  "Widget 扩展规范",
  "Manifest",
  "configSchema",
  "生命周期",
  "数据通道",
  "capabilities",
  "secret",
  "credentialRef",
  "manifest.json",
];
const missingSpec = specAnchors.filter((a) => !specDoc.includes(a));
ok("J8 spec doc covers the widget contract (manifest/configSchema/lifecycle/data/secret)", missingSpec.length === 0, missingSpec.length ? `missing: ${missingSpec.join(",")}` : `${specAnchors.length} anchors`);

const sdkIndex = readFileSync(path.join(ROOT, "packages/widget-sdk/src/index.ts"), "utf8");
ok("J8 contract package exports validator (validateManifest)", sdkIndex.includes("validateManifest"));

// ---- ③ 新增组件不改核心（结构检查）--------------------------------------
const board = readFileSync(path.join(ROOT, "apps/web/src/Board.tsx"), "utf8");
const typeKeys = ["todo", "rss", "app-launcher", "custom-api", "iframe", "placeholder", "stat-box"];
const leaks = typeKeys.filter((t) => board.includes(`"${t}"`) || board.includes(`'${t}'`));
ok("J8 core (Board layout host) has zero per-widget wiring", leaks.length === 0, leaks.length ? `hardcoded: ${leaks.join(",")}` : "no widget type keys in Board.tsx");

const registry = readFileSync(path.join(ROOT, "apps/web/src/widget-registry.ts"), "utf8");
ok(
  "J8 widgets registered in one place (widget-registry: manifests + components)",
  registry.includes("builtinManifests") && registry.includes("widgetComponents") && typeKeys.every((t) => registry.includes(t)),
);

// ---- 浏览器：选择器清单驱动 + 零代码组件样例 ------------------------------
const upstream = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ items: [{ name: "j8-sample", value: "42" }] }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/metrics`;

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
      // 多 Modal 并存时各自持有 .mantine-Modal-root（关闭态留空壳），按字段跨全部 root 查找
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
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  ok("J8 enter edit", await clickBtn("编辑布局"));
  await sleep(300);
  ok("J8 open widget picker", await clickBtn("添加组件"));
  await sleep(400);

  // ② 选择器清单由 builtinManifests 驱动（新增组件自动进清单，无需改核心 UI）
  const picker = await page.evaluate(() =>
    [...document.querySelectorAll(".mantine-Modal-root button")].map((b) => b.textContent.trim()),
  );
  const expectedNames = ["个人 Todo", "信息流", "看板", "应用入口", "嵌入页面", "自定义 API", "占位组件", "指标卡片"];
  const absent = expectedNames.filter((n) => !picker.some((t) => t.includes(n)));
  ok("J8 picker lists every builtin manifest (manifest-driven)", absent.length === 0, absent.length ? `missing: ${absent.join(",")}` : `${expectedNames.length} manifests`);
  ok(
    "J8 zero-code tier listed (iframe + custom-api, FR-W5②)",
    ["嵌入页面", "自定义 API"].every((n) => picker.some((t) => t.includes(n))),
  );

  // ② 零代码组件样例：纯配置 + 声明式模板 → 新组件视图，零代码
  ok("J8 pick 自定义 API (zero-code sample)", await clickBtn("自定义 API"));
  await sleep(400);
  ok("J8 sample configured via configSchema form", await setField("接口地址", upstreamUrl));
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll(".mantine-Modal-root [role=combobox]")].find((s) =>
      s.closest(".mantine-InputWrapper-root")?.querySelector("label")?.textContent.includes("展示模板"),
    );
    sel?.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((o) => o.textContent.includes("原始"));
    opt?.click();
  });
  await sleep(300);
  ok("J8 submit zero-code sample", await clickBtn("确认添加", true));
  await sleep(2500);

  const rendered = await page.evaluate(() => ({
    raw: (document.body.textContent ?? "").includes("j8-sample"),
    badge: (document.body.textContent ?? "").includes("42"),
  }));
  ok("J8 zero-code sample renders upstream data (no component code)", rendered.raw && rendered.badge, JSON.stringify(rendered));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
upstream.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
