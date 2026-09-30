import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("[c]", m.text().slice(0, 200)); });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle0", timeout: 20000 });
await sleep(1000);
const st = await page.evaluate(() => ({
  hasGrid: Boolean(document.querySelector(".grid-stack")),
  bodyLen: document.body.textContent.length,
  first: document.body.textContent.slice(0, 80),
}));
console.log(JSON.stringify(st));
await browser.close();
process.exit(0);
