/**
 * J5 acceptance: custom-api widget — configure via configSchema form (FR-W2),
 * server-side fetch with credential auth (FR-W3/SEC3), D14 template rendering.
 * Run: node scripts/verify-j5.mjs (server :3000 with ALLOW_PRIVATE_OUTBOUND=1, preview :4173)
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

// mock upstream requiring Bearer auth
const upstream = createServer((req, res) => {
  if (req.headers.authorization !== "Bearer sk-j5-secret") {
    res.writeHead(401).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ items: [{ name: "api-ok", value: "42" }] }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamPort = upstream.address().port;

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
      const btn = ex ? btns.find((b) => b.textContent.trim() === l) : btns.find((b) => b.textContent.trim().includes(l));
      if (!btn) return false;
      btn.click();
      return true;
    },
    { l: label, ex: exact },
  );

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]");
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  ok("J5 enter edit", await clickBtn("编辑布局"));
  await sleep(300);
  ok("J5 open API config form", await clickBtn("配置 API 组件"));
  await sleep(500);

  // FR-W2: form is generated from configSchema — fill it
  const filled = await page.evaluate((port) => {
    const set = (label, value) => {
      const inputs = [...document.querySelectorAll(".mantine-Modal-root input")];
      const target = inputs.find((i) => {
        const lbl = i.closest(".mantine-InputWrapper-root")?.querySelector("label");
        return lbl && lbl.textContent.includes(label);
      });
      if (!target) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    return {
      url: set("接口地址", `http://127.0.0.1:${port}/metrics`),
      token: set("访问令牌", "sk-j5-secret"),
      path: set("取值路径", "items"),
    };
  }, upstreamPort);
  ok("J5 form fields present (configSchema-driven)", filled.url && filled.token && filled.path, JSON.stringify(filled));

  // select display template = list via the Select component
  await page.evaluate(() => {
    const selects = [...document.querySelectorAll(".mantine-Modal-root [role=combobox]")];
    const display = selects.find((s) => {
      const lbl = s.closest(".mantine-InputWrapper-root")?.querySelector("label");
      return lbl && lbl.textContent.includes("展示模板");
    });
    display?.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((o) => o.textContent.includes("列表"));
    opt?.click();
  });
  await sleep(300);

  ok("J5 submit config form", await clickBtn("添加 API 组件", true));
  await sleep(2500); // modal close + widget render + data channel fetch

  const state = await page.evaluate(() => ({
    showsValue: document.body.textContent.includes("api-ok"),
    showsBadge: document.body.textContent.includes("42"),
    showsAuthError: document.body.textContent.includes("401"),
  }));
  ok(
    "J5 custom-api widget renders upstream data (auth + template)",
    state.showsValue && state.showsBadge && !state.showsAuthError,
    JSON.stringify(state),
  );

  // raw JSON template fallback check via second widget without token → 502 error path
  ok("J5 reopen config", await clickBtn("配置 API 组件"));
  await sleep(400);
  await page.evaluate((port) => {
    const inputs = [...document.querySelectorAll(".mantine-Modal-root input")];
    const set = (label, value) => {
      const target = inputs.find((i) => {
        const lbl = i.closest(".mantine-InputWrapper-root")?.querySelector("label");
        return lbl && lbl.textContent.includes(label);
      });
      if (!target) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("接口地址", `http://127.0.0.1:${port}/metrics`);
    set("访问令牌", "wrong-token"); // 错误 token → 上游 401 → 502
  }, upstreamPort);
  ok("J5 submit (no token → error shown)", await clickBtn("添加 API 组件", true));
  await sleep(2500);
  const errState = await page.evaluate(() =>
    document.body.textContent.includes("401") || document.body.textContent.includes("HTTP"),
  );
  ok("J5 upstream auth error surfaces to user (502 path)", errState);
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
upstream.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
