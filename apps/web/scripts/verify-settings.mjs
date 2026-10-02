/**
 * verify-settings —— 设置页与账户管理（B1/B2 · **D69 / FR-S2**）：
 *  ① 设置信息架构：头部单个「设置」→ 左右分栏五菜单（账户 / 外观 / 插件 / 数据源 / 关于）
 *     → 各面板承载既有功能（主题切换 / 插件管理 / 数据源管理 7 页签 / 关于）；
 *  ② 账户：改用户名（错当前密码 401、成功后**头部用户名跟随**）；
 *     改密码（错当前密码 401、<8 位与两次不一致客户端拦截、成功后**旧口令失效**）；
 *  ③ 退出登录 → 回登录页。
 *
 * ⚠ 本脚本会**临时修改账户凭据**并在结尾用 Node 侧 API 恢复（不依赖浏览器进程）。
 * 建议在一次性实例上跑（同 verify-gmail）：`PORT=3001 DATABASE_URL=file:/tmp/…/app.db ADMIN_PASSWORD=…`
 * 起服务端（**注意是 `DATABASE_URL`，不是 `DATA_DIR`** —— dataDir 由它派生），
 * `VITE_API_PROXY=http://127.0.0.1:3001` 起 preview；在长期实例上跑请确认跑完恢复成功。
 * Run: node scripts/verify-settings.mjs（server :3000/:3001 + preview :4173）
 */
import puppeteer from "puppeteer-core";
import { ADMIN_PASSWORD, backToWorkspace, login, makeApiFetch, makeOk, openSettings, sleep, summarize, uniqId } from "./lib/verify-kit.mjs";

const WEB = "http://localhost:4173";
const results = [];
const ok = makeOk(results);
const uniq = uniqId("set-");
const TMP_USER = `tmp-user-${uniq}`;
const TMP_PASS = `tmp-pass-${uniq}`;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const panelText = () =>
  page.evaluate(() => document.querySelector(".wb-settings__panel")?.textContent ?? "");

/** formIndex：0 = 用户名表单，1 = 密码表单（两组各有「当前密码」，按组作用域定位）。 */
const setInputs = async (formIndex, values) =>
  page.evaluate(
    ({ idx, pairs }) => {
      const form = document.querySelectorAll(".wb-settings__form")[idx];
      if (!form) return 0;
      const wrappers = [...form.querySelectorAll(".mantine-InputWrapper-root")];
      for (const w of wrappers) delete w.dataset.filled; // 每次调用重新定位（同名字段按调用内顺序消歧）
      let done = 0;
      for (const [label, value] of pairs) {
        const w = wrappers.find((x) => x.querySelector("label")?.textContent.includes(label) && !x.dataset.filled);
        const input = w?.querySelector("input");
        if (!input) continue;
        w.dataset.filled = "1";
        const proto = window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        done++;
      }
      return done;
    },
    { idx: formIndex, pairs: values },
  );

/** Node 侧同源 fetch（恢复凭据用 —— 浏览器挂了也能收尾）。 */
const apiFetchNode = async (path, { method = "POST", body, cookie } = {}) => {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), // oxlint(no-invalid-fetch-options)：GET 不带 body
  });
  const text = await res.text();
  return { status: res.status, text, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
};

let originalUser = "admin";
let changed = false;

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await login(page);
  const apiFetch = makeApiFetch(page);
  originalUser = JSON.parse((await apiFetch("/api/auth/me")).body).username;

  // ── ① 设置信息架构：五菜单逐个可达（B1/D69）──
  ok("SET open settings · 账户", await openSettings(page, "账户"));
  ok("SET account panel shows username", (await panelText()).includes(originalUser));
  ok("SET open settings · 外观", await openSettings(page, "外观"));
  ok("SET appearance panel has theme switch", (await panelText()).includes("主题"));
  ok("SET open settings · 插件", await openSettings(page, "插件"));
  ok("SET plugins panel opens (panel, not modal)", (await panelText()).includes("插件管理"));
  ok("SET open settings · 数据源", await openSettings(page, "数据源"));
  ok("SET data panel embeds data admin (7 tabs)", await page.evaluate(() => Boolean(document.querySelector(".wb-admin"))));
  ok("SET open settings · 关于", await openSettings(page, "关于"));
  ok("SET about panel has product info", (await panelText()).includes("个人工作台"));
  ok("SET back to workspace", await backToWorkspace(page));
  await sleep(400);
  ok("SET workspace rendered after back", await page.evaluate(() => Boolean(document.querySelector(".wb-settings")) === false));

  // ── ② 账户：改用户名（FR-S2：必须验证当前密码）──
  ok("SET open account panel", await openSettings(page, "账户"));
  await setInputs(0, [["新用户名", TMP_USER], ["当前密码", "wrong-password"]]);
  ok("SET change username with wrong current password", await page.evaluate(() => {
    const b = [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").includes("保存用户名"));
    b?.click();
    return Boolean(b);
  }));
  await sleep(800);
  ok("SET wrong current password rejected (401 surfaced)", (await panelText()).includes("当前密码不正确"), (await panelText()).slice(0, 120));
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE 长连接让 networkidle0 永不满足
  await page.waitForSelector(".grid-stack, .wb-settings", { timeout: 8000 }); // 深链 reload 可能停在设置页
  await openSettings(page, "账户");
  await setInputs(0, [["新用户名", TMP_USER], ["当前密码", ADMIN_PASSWORD]]);
  await page.evaluate(() => {
    [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").includes("保存用户名"))?.click();
  });
  await sleep(1000);
  changed = true;
  ok("SET username changed (success message)", (await panelText()).includes("用户名已更新"), (await panelText()).slice(0, 120));
  ok(
    "SET header username follows the change",
    await page.evaluate((u) => (document.body.textContent ?? "").includes(u), TMP_USER),
    TMP_USER,
  );

  // ── ③ 账户：改密码（校验 + 错当前密码 + 成功）──
  await setInputs(1, [["当前密码", "wrong-password"], ["新密码", TMP_PASS], ["再输一次新密码", TMP_PASS]]);
  await page.evaluate(() => {
    [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").includes("保存密码"))?.click();
  });
  await sleep(800);
  ok("SET change password with wrong current password rejected", (await panelText()).includes("当前密码不正确"));
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE 长连接让 networkidle0 永不满足
  await page.waitForSelector(".grid-stack, .wb-settings", { timeout: 8000 }); // 深链 reload 可能停在设置页
  await openSettings(page, "账户");
  await setInputs(1, [["当前密码", ADMIN_PASSWORD], ["新密码", TMP_PASS], ["再输一次新密码", `${TMP_PASS}-mismatch`]]);
  await page.evaluate(() => {
    [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").includes("保存密码"))?.click();
  });
  await sleep(500);
  ok("SET mismatched new password rejected client-side", (await panelText()).includes("不一致"));
  await setInputs(1, [["当前密码", ADMIN_PASSWORD], ["新密码", TMP_PASS], ["再输一次新密码", TMP_PASS]]);
  await page.evaluate(() => {
    [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").includes("保存密码"))?.click();
  });
  await sleep(1200);
  ok("SET password changed (success message)", (await panelText()).includes("密码已更新"), (await panelText()).slice(0, 120));

  // 旧口令失效 / 新口令可用（页面内 fetch 验证）
  const loginProbe = await page.evaluate(
    async ({ u, p }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      return res.status;
    },
    { u: TMP_USER, p: ADMIN_PASSWORD },
  );
  ok("SET old password no longer works", loginProbe === 401, `status=${loginProbe}`);
  const loginProbe2 = await page.evaluate(
    async ({ u, p }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      return res.status;
    },
    { u: TMP_USER, p: TMP_PASS },
  );
  ok("SET new password works", loginProbe2 === 200, `status=${loginProbe2}`);

  // ── ④ 退出登录（入口已移入账户面板）──
  await page.evaluate(() => {
    [...document.querySelectorAll(".wb-settings__panel button")].find((x) => (x.textContent ?? "").includes("退出登录"))?.click();
  });
  await sleep(1000);
  ok("SET logout returns to login page", await page.evaluate(() => Boolean(document.querySelector("input[autocomplete=current-password]"))));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

// ── 恢复现场（Node 侧，浏览器无关）：用户名/口令回到进入时的值 ──
try {
  if (changed) {
    const loginRes = await apiFetchNode("/api/auth/login", { body: { username: TMP_USER, password: TMP_PASS } });
    const cookie = loginRes.cookie;
    const r1 = await apiFetchNode("/api/auth/change-username", { body: { currentPassword: TMP_PASS, username: originalUser }, cookie });
    const r2 = await apiFetchNode("/api/auth/change-password", { body: { currentPassword: TMP_PASS, newPassword: ADMIN_PASSWORD }, cookie });
    ok("SET credentials restored (username/password)", r1.status === 200 && r2.status === 200, `user=${r1.status} pw=${r2.status}`);
  }
} catch (e) {
  ok("SET credentials restored (username/password)", false, String(e).slice(0, 160));
}

await browser.close();
summarize(results);
process.exit(results.some((r) => !r.pass) ? 1 : 0);
