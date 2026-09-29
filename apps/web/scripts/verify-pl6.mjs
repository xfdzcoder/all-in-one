/**
 * PL6 acceptance (FR-W6 插件管理页): 上传 → 校验（含非法包报错）→ 启用/禁用 →
 * 卸载清理；启用后**无需刷新**即进入组件选择器（宿主清单实时失效）。
 * Run: node scripts/verify-pl6.mjs (server :3000, preview :4173)
 */
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strToU8, zipSync } from "fflate";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLUGIN_TYPE = "hello-plugin";

const manifest = {
  type: PLUGIN_TYPE,
  name: "Hello 插件",
  description: "PL6 管理页验收样例",
  category: "插件",
  defaultSize: { w: 4, h: 3 },
  configSchema: [{ key: "title", label: "标题", type: "text", default: "pl6" }],
  capabilities: { data: { source: "none" } },
  plugin: {
    entry: "widget.js",
    apiVersion: "1.0.0",
    permissions: { credentialKinds: ["http-header"], actions: ["hello.ping"] },
  },
};

const dir = mkdtempSync(join(tmpdir(), "ail-pl6-"));
const goodZip = join(dir, "hello-plugin.zip");
const badZip = join(dir, "broken.zip");
writeFileSync(
  goodZip,
  zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "widget.js": strToU8("export default function render(props, ctx) { ctx.root.textContent = 'hi'; }"),
  }),
);
writeFileSync(badZip, zipSync({ "widget.js": strToU8("no manifest here") }));

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

const adminText = () =>
  page.evaluate(() =>
    // 关闭态 Modal 也留空壳 root —— 合并全部 root 文本（空壳无内容，不影响判定）
    [...document.querySelectorAll(".mantine-Modal-root")].map((m) => m.textContent ?? "").join(" "),
  );

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  // 清理同名残留（可重复执行）
  const existing = JSON.parse((await apiFetch("/api/plugins")).body);
  for (const p of existing.filter((x) => x.type === PLUGIN_TYPE)) {
    await apiFetch(`/api/plugins/${p.id}`, { method: "DELETE" });
  }

  // 打开管理页（FR-W6 入口，桌面端）
  ok("PL6 open plugin admin", await clickBtn("插件管理"));
  await sleep(400);
  ok("PL6 admin dialog opens", (await adminText()).includes("插件管理"));

  // 校验失败路径：非法包（缺 manifest.json）→ 明确报错
  const badInput = await page.$('input[type="file"]');
  ok("PL6 file input present", Boolean(badInput));
  await badInput.uploadFile(badZip);
  await sleep(200);
  ok("PL6 install invalid package", await clickBtn("安装", true));
  await sleep(800);
  const badText = await adminText();
  ok("PL6 invalid package rejected with reason", badText.includes("manifest.json missing"), badText.slice(0, 120));

  // 上传安装
  await (await page.$('input[type="file"]')).uploadFile(goodZip);
  await sleep(200);
  ok("PL6 install plugin package", await clickBtn("安装", true));
  await sleep(1000);
  const listText = await adminText();
  ok("PL6 plugin listed with 未启用 status", listText.includes("Hello 插件") && listText.includes("未启用"));
  ok("PL6 permissions summary shown (FR-W7)", listText.includes("凭证:http-header") && listText.includes("动作:hello.ping"));

  // 启用 → 无需刷新即进组件选择器（清单实时失效）
  ok("PL6 enable plugin", await clickBtn("启用"));
  await sleep(800);
  ok("PL6 status becomes 已启用", (await adminText()).includes("已启用"));
  await page.keyboard.press("Escape");
  await sleep(300);
  ok("PL6 enter edit", await clickBtn("编辑布局"));
  await sleep(300);
  ok("PL6 open picker", await clickBtn("添加组件"));
  await sleep(400);
  const picker = await page.evaluate(() =>
    [...document.querySelectorAll(".mantine-Modal-root button")].map((b) => b.textContent.trim()),
  );
  ok("PL6 enabled plugin listed in picker without reload", picker.some((t) => t.includes("Hello 插件")));
  await page.keyboard.press("Escape");
  await sleep(300);
  ok("PL6 exit edit", await clickBtn("完成编辑"));
  await sleep(300);

  // 禁用 → 卸载清理
  ok("PL6 reopen admin", await clickBtn("插件管理"));
  await sleep(400);
  ok("PL6 disable plugin", await clickBtn("禁用"));
  await sleep(800);
  const disabledText = await adminText();
  ok("PL6 status becomes 已禁用", disabledText.includes("已禁用"), disabledText.slice(0, 120));
  ok("PL6 uninstall plugin", await clickBtn("卸载"));
  await sleep(800);
  const afterText = await adminText();
  // 成功提示含插件名，行内容含 type —— 以 type 判定行已移除
  ok("PL6 row removed after uninstall", !afterText.includes(PLUGIN_TYPE) && afterText.includes("尚未安装插件"), afterText.slice(0, 120));

  const gone = JSON.parse((await apiFetch("/api/plugins")).body);
  ok("PL6 REST list empty after uninstall", gone.every((p) => p.type !== PLUGIN_TYPE));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
