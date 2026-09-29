import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const upstream = createServer((req, res) => {
  console.log("UPSTREAM req auth:", req.headers.authorization);
  if (req.headers.authorization !== "Bearer sk-j5-secret") { res.writeHead(401).end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ items: [{ name: "api-ok", value: "42" }] }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const port = upstream.address().port;
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("console", (m) => console.log("C:", m.text().slice(0, 250)));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 400)));
page.on("request", (r) => { if (r.url().includes("/api")) console.log("REQ:", r.method(), r.url().slice(0, 80), (r.postData() ?? "").slice(0, 150)); });
page.on("response", async (r) => { if (r.url().includes("widgets/data")) { try { console.log("RES:", r.status(), (await r.text()).slice(0, 200)); } catch {} } });
await page.setViewport({ width: 1400, height: 900 });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle0" });
await page.type("input[autocomplete=username]", "admin");
await page.type("input[autocomplete=current-password]", "m1-e2e-pass");
await page.click("button[type=submit]");
await page.waitForSelector(".grid-stack");
await sleep(500);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("编辑布局"))?.click());
await sleep(300);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("配置 API 组件"))?.click());
await sleep(500);
await page.evaluate((port) => {
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
  window.__f = { url: set("接口地址", `http://127.0.0.1:${port}/metrics`), token: set("访问令牌", "sk-j5-secret") };
}, port);
console.log("filled:", await page.evaluate(() => JSON.stringify(window.__f)));
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "添加 API 组件")?.click());
await sleep(3000);
const dom = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".grid-stack-item")];
  const last = items[items.length - 1];
  return JSON.stringify({ lastId: last?.getAttribute("gs-id"), html: last?.textContent?.slice(0, 200) });
});
console.log("DOM:", dom);
await browser.close();
upstream.close();
