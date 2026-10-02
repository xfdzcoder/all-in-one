/**
 * J7 acceptance: iframe widget — configurable URL + sandbox policy (FR-W2/SEC5),
 * embed-blocked hint when the target forbids framing (X-Frame-Options / CSP
 * frame-ancestors), with "open in new tab" escape hatch.
 * 禁嵌判定由 iframe-embed connector 读响应头完成（浏览器禁嵌时 load 事件照常触发）。
 * D67：默认沙箱含 allow-same-origin（框内请求 Origin 非 null）+ 同源地址拒绝嵌入。
 * mock A: embeddable page（自证 doc/请求 Origin）; mock B: X-Frame-Options: DENY + frame-ancestors 'none'.
 * Run: node scripts/verify-j7.mjs (server :3000, preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
import { login, makeClickBtn, makeOk, sleep } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173/";
const results = [];
const ok = makeOk(results); // TST-14/15：公共库（签名/输出/非布尔告警统一）

const embeddable = createServer((req, res) => {
  if (req.url === "/origin-echo") {
    // 回显请求的 Origin 头（POST 必带 Origin）——框内页面据此自证源是否不透明（D67）
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(req.headers.origin ?? "(no-origin-header)");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><title>embed-ok</title><h1>embed-ok</h1>
<div id="doc-origin">?</div><div id="req-origin">?</div>
<script>
document.getElementById("doc-origin").textContent = "ORIGIN=" + location.origin;
fetch("/origin-echo", { method: "POST" })
  .then((r) => r.text())
  .then((t) => { document.getElementById("req-origin").textContent = "ECHO=" + t; })
  .catch(() => { document.getElementById("req-origin").textContent = "ECHO=FETCH_FAILED"; });
</script>`);
});
await new Promise((r) => embeddable.listen(0, "127.0.0.1", r));
const embedUrl = `http://127.0.0.1:${embeddable.address().port}/`;

const blocked = createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
  });
  res.end("<!doctype html><title>blocked</title><h1>blocked</h1>");
});
await new Promise((r) => blocked.listen(0, "127.0.0.1", r));
const blockedUrl = `http://127.0.0.1:${blocked.address().port}/`;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const clickBtn = makeClickBtn(page); // TST-12/14：精确优先匹配（首个命中陷阱消解）

const setField = (label, value) =>
  page.evaluate(
    ({ l, v }) => {
      // 多 Modal 并存时各自持有 .mantine-Modal-root（关闭态留空壳），按字段跨全部 root 查找
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      const target = wrapper?.querySelector("input");
      if (!target) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(target, v);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { l: label, v: value },
  );

/** 选择器 → 嵌入页面 → 表单（URL/沙箱）→ 确认添加。 */
const addIframe = async (url, sandbox) => {
  if (!(await clickBtn("添加组件"))) return false;
  await sleep(300);
  if (!(await clickBtn("嵌入页面"))) return false;
  await sleep(400);
  if (!(await setField("页面地址", url))) return false;
  if (sandbox !== null && !(await setField("沙箱能力", sandbox))) return false;
  await sleep(200);
  return clickBtn("确认添加", true);
};

const frameState = (url) =>
  page.evaluate((u) => {
    const frame = [...document.querySelectorAll("iframe")].find((f) => f.getAttribute("src") === u);
    // 作用域到本卡（D67 后同屏可有多张 iframe 卡，全文档查找会命中别的卡的提示/逃生口）
    const widget = [...document.querySelectorAll(".wb-widget")].find(
      (w) => w.querySelector(".wb-url")?.textContent?.trim() === u,
    );
    const scope = widget ?? document.body;
    return {
      exists: Boolean(frame),
      sandbox: frame?.getAttribute("sandbox") ?? null,
      hidden: frame ? getComputedStyle(frame).display === "none" : null,
      hint: (scope.textContent ?? "").includes("无法嵌入此页面"),
      escapeHref: [...scope.querySelectorAll("a")].find((a) => a.textContent.includes("在新标签页打开"))
        ?.getAttribute("href") ?? null,
    };
  }, url);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page); // TST-14：登录块单点（选择器变更只改 verify-kit）
  // TST-19：测前快照布局、测后还原 —— 本脚本加的 iframe 卡不留用户盘（此前漏接守卫，实测污染过「用户页面禁止修改」）
  await installLayoutGuard(page);

  ok("J7 enter edit", await clickBtn("编辑页面"));
  await sleep(300);

  // 可嵌入页面：自定义沙箱策略生效，禁嵌检测通过（不出现提示）
  ok("J7 add iframe via picker (embeddable url + custom sandbox)", await addIframe(embedUrl, "allow-scripts allow-same-origin"));
  await sleep(500);
  const a1 = await frameState(embedUrl);
  ok("J7 iframe renders configured url", a1.exists, embedUrl);
  ok("J7 sandbox policy applied (SEC5)", a1.sandbox === "allow-scripts allow-same-origin", `sandbox="${a1.sandbox}"`);
  await sleep(3500); // 禁嵌检测完成后仍不应报禁嵌
  const a2 = await frameState(embedUrl);
  ok("J7 embeddable page loads without blocked hint", !a2.hint && !a2.hidden, JSON.stringify(a2));

  // D67：框内请求 Origin 不是 null（默认沙箱含 allow-same-origin → 框内页面拿回自己的正常源）
  const frame = page.frames().find((f) => f.url().startsWith(embedUrl));
  const frameText = frame ? await frame.evaluate(() => document.body.innerText) : "";
  ok(
    "J7 in-frame origin is not null (D67)",
    frameText.includes(`ORIGIN=http://127.0.0.1:${embeddable.address().port}`),
    frameText.slice(0, 160),
  );
  ok(
    "J7 in-frame request carries real Origin header (D67)",
    frameText.includes(`ECHO=http://127.0.0.1:${embeddable.address().port}`),
    frameText.slice(0, 160),
  );

  // D67：同源地址拒绝嵌入（同源 + allow-scripts + allow-same-origin = 绕过沙箱）
  const hostOrigin = new URL(WEB).origin;
  ok("J7 add iframe via picker (same-origin url, must be refused)", await addIframe(hostOrigin + "/", null));
  await sleep(600);
  const c1 = await frameState(hostOrigin + "/");
  ok(
    "J7 same-origin embed refused with explicit hint (D67)",
    !c1.exists && (await page.evaluate(() => (document.body.textContent ?? "").includes("不能嵌入工作台自身的地址"))),
    JSON.stringify(c1),
  );

  // 禁嵌页面：X-Frame-Options / frame-ancestors 拒绝 → 明确提示 + 新标签页逃生口
  ok("J7 add iframe via picker (blocked url, default sandbox)", await addIframe(blockedUrl, null));
  await sleep(500);
  const b1 = await frameState(blockedUrl);
  ok("J7 default sandbox = allow-scripts + allow-same-origin + allow-forms (D67/Q115)", b1.sandbox === "allow-scripts allow-same-origin allow-forms", `sandbox="${b1.sandbox}"`);
  let b2 = b1;
  for (let i = 0; i < 16 && !b2.hint; i++) {
    await sleep(500);
    b2 = await frameState(blockedUrl);
  }
  ok("J7 embed-blocked hint shown (XFO/frame-ancestors)", b2.hint, JSON.stringify(b2));
  ok("J7 blocked frame hidden + escape link to target", b2.hidden === true && b2.escapeHref === blockedUrl, `hidden=${b2.hidden} href=${b2.escapeHref}`);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
await browser.close();
embeddable.close();
blocked.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
