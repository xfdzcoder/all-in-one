/**
 * PL7 acceptance (FR-W3 数据桥 + FR-W7 权限白名单执行，D26):
 *  ① 插件数据走宿主统一数据通道（http-connector），凭证明文仅服务端注入；
 *  ② permissions.apis 未含 widgets.data → 取数拒绝（UI 可见报错）；
 *  ③ permissions.credentialKinds 未声明的凭证件 kind → 拒绝（UI 可见报错）。
 * Run: node scripts/verify-pl7.mjs (server :3000 with ALLOW_PRIVATE_OUTBOUND=1,
 *      preview :4173)
 */
import { createServer } from "node:http";
import { strToU8, zipSync } from "fflate";
import puppeteer from "puppeteer-core";
import { login, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

// mock upstream：要求 Bearer sk-secret，回显鉴权头
const upstream = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, auth: req.headers.authorization === "Bearer sk-secret" ? "auth" : "" }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/`;

const entryCode = `export default function render(props, ctx) {
  const d = props.data || {};
  ctx.root.textContent = "plugdata:" + (d.auth ? "authed" : "anon") + ":" + (d.ok ? "ok" : "no");
}`;

const manifest = (type, permissions) => ({
  type,
  name: `PL7 ${type}`,
  category: "插件",
  defaultSize: { w: 4, h: 3 },
  configSchema: [
    { key: "url", label: "地址", type: "text", required: true },
    { key: "apiToken", label: "令牌", type: "secret" },
  ],
  capabilities: { data: { source: "http-connector" } },
  plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions },
});

const packageBase64 = (type, permissions) =>
  Buffer.from(
    zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest(type, permissions))),
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

const frameText = async () => {
  let frame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  for (let i = 0; i < 20 && !frame; i++) {
    await sleep(300);
    frame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  }
  for (let i = 0; i < 20; i++) {
    const text = await frame?.evaluate(() => document.getElementById("root")?.textContent ?? "") ?? "";
    if (text) return text;
    await sleep(300);
  }
  return "";
};

const installAndEnable = async (type, permissions) => {
  const existing = JSON.parse((await apiFetch("/api/plugins")).body);
  for (const p of existing.filter((x) => x.type === type)) {
    await apiFetch(`/api/plugins/${p.id}`, { method: "DELETE" });
  }
  const installed = await apiFetch("/api/plugins", {
    method: "POST",
    body: JSON.stringify({ packageBase64: packageBase64(type, permissions) }),
  });
  const id = JSON.parse(installed.body).id;
  await apiFetch(`/api/plugins/${id}/enable`, { method: "POST" });
  return id;
};

/** 选择器添加插件并填配置（url / 令牌）。 */
const addPluginWidget = async (name, url, token) => {
  ok(`PL7 add ${name} via picker`, await clickBtn("添加组件") && (await sleep(300), await clickBtn(name)));
  await sleep(400);
  ok(`PL7 ${name} config url`, await setField("地址", url));
  if (token) ok(`PL7 ${name} config token`, await setField("令牌", token));
  await sleep(200);
  ok(`PL7 ${name} submit`, await clickBtn("确认添加", true));
  await sleep(1500);
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）

  const idA = await installAndEnable("pl7-a", {
    apis: ["widgets.data"],
    credentialKinds: ["http-header"],
  });
  const idB = await installAndEnable("pl7-b", { apis: ["widgets.data"] });
  const idC = await installAndEnable("pl7-c", {});
  ok("PL7 install+enable three fixtures", Boolean(idA && idB && idC));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);
  ok("PL7 enter edit", await clickBtn("编辑页面"));
  await sleep(300);

  // ① 数据桥 + 凭证注入（声明的 credentialKinds 放行）
  await addPluginWidget("PL7 pl7-a", upstreamUrl, "sk-secret");
  const textA = await frameText();
  ok("PL7 data bridge: plugin renders host-fetched data", textA.includes("plugdata:authed:ok"), textA);

  // ② apis 未声明 → 拒绝取数（UI 报错）
  await addPluginWidget("PL7 pl7-c", upstreamUrl, null);
  const bodyC = await page.evaluate(() => document.body.textContent ?? "");
  ok("PL7 widgets.data denied without apis permission", bodyC.includes("widgets.data"), bodyC.slice(-160));

  // ③ credentialKinds 未声明 → 拒绝（UI 报错）
  await addPluginWidget("PL7 pl7-b", upstreamUrl, "sk-secret");
  const bodyB = await page.evaluate(() => document.body.textContent ?? "");
  ok("PL7 credential kind denied without credentialKinds", bodyB.includes("credential kind"), bodyB.slice(-160));

  // 清理
  for (const id of [idA, idB, idC]) {
    await apiFetch(`/api/plugins/${id}`, { method: "DELETE" });
  }
  const left = JSON.parse((await apiFetch("/api/plugins")).body);
  ok("PL7 uninstall cleanup", left.every((p) => !String(p.type).startsWith("pl7-")));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
upstream.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
