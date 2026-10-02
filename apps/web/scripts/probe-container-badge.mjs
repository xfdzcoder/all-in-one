/**
 * 一次性排查：容器清单徽标的字体/尺寸实测 + 截图（Q93 反馈③ 未修完）。
 * 自建临时草稿盘挂真机 Portainer 卡片 → 测量 + 截图 → 自删。
 */
import puppeteer from "puppeteer-core";

const API = "http://127.0.0.1:3000";
const WEB = "http://localhost:4173/";
const PASSWORD = process.env.LIVE_ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error("缺少 LIVE_ADMIN_PASSWORD");
  process.exit(1);
}

const cookie = await (async () => {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: PASSWORD }),
  });
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
})();
const api = async (path, body, method = "GET") => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json", Cookie: cookie } : { Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {}), // unicorn(no-invalid-fetch-options)：GET 禁带 body
  });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};

const srcs = await api("/api/data-sources");
const por = (srcs ?? []).find((s) => s.kind === "portainer");
if (!por) {
  console.error("DB 里没有 Portainer 数据源");
  process.exit(1);
}
const dash = await api("/api/dashboards", { title: `开发-徽标排查-${Date.now().toString(36)}` }, "POST");
await api(`/api/dashboards/${dash.id}/layout`, {
  layoutJson: JSON.stringify([
    {
      id: "por1",
      component: "portainer-containers",
      x: 0,
      y: 0,
      w: 6,
      h: 8,
      props: { sourceId: por.id },
    },
  ]),
}, "PUT");

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--window-size=1400,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 15000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));

  await page.evaluate((_title) => {
    const all = [...document.querySelectorAll("button, a, [role=menuitem], [role=option], li")];
    const trigger = all.find((b) => /▾/.test(b.textContent || ""));
    trigger?.click();
  }, dash._title);
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate((_title) => {
    [...document.querySelectorAll("button, a, [role=menuitem], [role=option], li")]
      .find((b) => (b.textContent || "").trim() === _title)
      ?.click();
  }, dash._title);
  await page.waitForSelector(".wb-container-row", { timeout: 25000 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 2500));

  const info = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wb-container-row")].slice(0, 3);
    return rows.map((row) => {
      const badge = row.querySelector(".mantine-Badge-root");
      const name = row.children[0];
      const status = row.children[2];
      const b = badge ? getComputedStyle(badge) : null;
      return {
        nameText: (name?.textContent || "").trim(),
        badgeText: (badge?.textContent || "").trim(),
        badgeSizeAttr: badge?.getAttribute("data-size"),
        badgeFontSize: b?.fontSize,
        badgeHeight: b?.height,
        badgeLh: b?.lineHeight,
        badgeScroll: badge?.scrollWidth,
        badgeClient: badge?.clientWidth,
        badgeTextWidth: badge ? (badge.firstChild ? badge.getBoundingClientRect().width : 0) : null,
        nameFontSize: name ? getComputedStyle(name).fontSize : null,
        statusFontSize: status ? getComputedStyle(status).fontSize : null,
      };
    });
  });
  console.log(JSON.stringify(info, null, 1));

  const card = await page.$(".wb-container-row");
  if (card) {
    const parent = await card.evaluateHandle((el) => el.closest(".grid-stack-item-content") ?? el);
    await parent.asElement().screenshot({ path: "/tmp/opencode/container-card.png" });
    console.log("screenshot -> /tmp/opencode/container-card.png");
  }
} finally {
  await browser?.close();
  await api(`/api/dashboards/${dash.id}`, undefined, "DELETE").catch(() => {});
}
