/**
 * J7 acceptance: iframe widget — configurable URL + sandbox policy (FR-W2/SEC5),
 * embed-blocked hint when the target forbids framing (X-Frame-Options / CSP
 * frame-ancestors), with "open in new tab" escape hatch.
 * 禁嵌判定由 iframe-embed connector 读响应头完成（浏览器禁嵌时 load 事件照常触发）。
 * mock A: embeddable page; mock B: X-Frame-Options: DENY + frame-ancestors 'none'.
 * Run: node scripts/verify-j7.mjs (server :3000, preview :4173)
 */
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const embeddable = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<!doctype html><title>embed-ok</title><h1>embed-ok</h1>");
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
    return {
      exists: Boolean(frame),
      sandbox: frame?.getAttribute("sandbox") ?? null,
      hidden: frame ? getComputedStyle(frame).display === "none" : null,
      hint: (document.body.textContent ?? "").includes("无法嵌入此页面"),
      escapeHref: [...document.querySelectorAll("a")].find((a) => a.textContent.includes("在新标签页打开"))
        ?.getAttribute("href") ?? null,
    };
  }, url);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  ok("J7 enter edit", await clickBtn("编辑布局"));
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

  // 禁嵌页面：X-Frame-Options / frame-ancestors 拒绝 → 明确提示 + 新标签页逃生口
  ok("J7 add iframe via picker (blocked url, default sandbox)", await addIframe(blockedUrl, null));
  await sleep(500);
  const b1 = await frameState(blockedUrl);
  ok("J7 default sandbox = minimal allow-scripts", b1.sandbox === "allow-scripts", `sandbox="${b1.sandbox}"`);
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

await browser.close();
embeddable.close();
blocked.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
