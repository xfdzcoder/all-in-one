import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.setViewport({ width: 1400, height: 900 });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle0" });
await page.type("input[autocomplete=username]", "admin");
await page.type("input[autocomplete=current-password]", "m1-e2e-pass");
await page.click("button[type=submit]");
await new Promise((r) => setTimeout(r, 3000));
const st = await page.evaluate(() => ({
  widgets: document.querySelectorAll(".grid-stack-item").length,
  slot: Boolean(document.getElementById("wb-header-edit-slot")),
  addBtnInHeader: Boolean([...document.querySelectorAll("#wb-header-edit-slot button")].find((b) => b.textContent.includes("添加组件"))),
}));
console.log(JSON.stringify(st, null, 1));
await browser.close();
process.exit(0);
