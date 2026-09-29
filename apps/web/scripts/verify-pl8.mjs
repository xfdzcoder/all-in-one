/**
 * PL8 acceptance (FR-I5 插件动作执行通道，D27):
 *  ① 沙箱内按钮 → ctx.onAction → 桥 → 宿主 → 服务端白名单校验 + 执行（todo.create），
 *     Workspace 数据真实新增（Todo 组件即刻可见）；
 *  ② permissions.actions 未声明的动作 → 宿主侧直接拒绝（可见报错，请求不发出）。
 * Run: node scripts/verify-pl8.mjs (server :3000, preview :4173)
 */
import { strToU8, zipSync } from "fflate";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-4);

const entryCode = `export default function render(props, ctx) {
  const btn = document.createElement("button");
  btn.textContent = "pl8-do-" + (props.config.title || "");
  btn.onclick = () => ctx.onAction("todo.create", { title: props.config.title });
  ctx.root.replaceChildren(btn);
}`;

const manifest = (type, actions) => ({
  type,
  name: `PL8 ${type}`,
  category: "插件",
  defaultSize: { w: 4, h: 2 },
  configSchema: [{ key: "title", label: "标题", type: "text", required: true }],
  capabilities: { data: { source: "none" } },
  plugin: { entry: "widget.js", apiVersion: "1.0.0", permissions: { actions } },
});

const packageBase64 = (type, actions) =>
  Buffer.from(
    zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest(type, actions))),
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
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
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

const installAndEnable = async (type, actions) => {
  const existing = JSON.parse((await apiFetch("/api/plugins")).body);
  for (const p of existing.filter((x) => x.type === type)) {
    await apiFetch(`/api/plugins/${p.id}`, { method: "DELETE" });
  }
  const installed = await apiFetch("/api/plugins", {
    method: "POST",
    body: JSON.stringify({ packageBase64: packageBase64(type, actions) }),
  });
  const id = JSON.parse(installed.body).id;
  await apiFetch(`/api/plugins/${id}/enable`, { method: "POST" });
  return id;
};

const pluginFrame = async () => {
  let frame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  for (let i = 0; i < 20 && !frame; i++) {
    await sleep(300);
    frame = page.frames().find((f) => f.url().startsWith("about:srcdoc"));
  }
  return frame;
};

const addPluginWidget = async (name, title) => {
  ok(`PL8 add ${name} via picker`, await clickBtn("添加组件"));
  await sleep(300);
  ok(`PL8 pick ${name}`, await clickBtn(name));
  await sleep(400);
  ok(`PL8 config title`, await setField("标题", title));
  await sleep(200);
  ok(`PL8 submit ${name}`, await clickBtn("确认添加", true));
  await sleep(1500);
};

const clickInFrames = async (label) => {
  for (const f of page.frames().filter((x) => x.url().startsWith("about:srcdoc"))) {
    const hit = await f.evaluate((l) => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === l);
      if (!btn) return false;
      btn.click();
      return true;
    }, label);
    if (hit) return true;
  }
  return false;
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  const idA = await installAndEnable("pl8-a", ["todo.create"]);
  const idB = await installAndEnable("pl8-b", []);
  ok("PL8 install+enable action fixtures", Boolean(idA && idB));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(500);
  ok("PL8 enter edit", await clickBtn("编辑布局"));
  await sleep(300);

  // ① 动作通道：沙箱按钮 → 桥 → 服务端执行 todo.create
  const titleA = `pl8-task-${uniq}`;
  await addPluginWidget("PL8 pl8-a", titleA);
  ok("PL8 plugin frame with button", Boolean(await pluginFrame()));
  ok("PL8 click action button in sandbox", await clickInFrames(`pl8-do-${titleA}`));
  await sleep(1200);
  const todos = JSON.parse((await apiFetch(`/api/todos`)).body);
  ok("PL8 action created todo server-side", todos.some((t) => t.title === titleA), `todos=${todos.length}`);
  const bodyText = await page.evaluate(() => document.body.textContent ?? "");
  ok("PL8 todo visible in workbench (Workspace data)", bodyText.includes(titleA));

  // ② 未声明动作 → 宿主侧拒绝（可见报错，不发请求）
  const titleB = `pl8-denied-${uniq}`;
  await addPluginWidget("PL8 pl8-b", titleB);
  ok("PL8 click denied action button", await clickInFrames(`pl8-do-${titleB}`));
  await sleep(800);
  const deniedText = await page.evaluate(() => document.body.textContent ?? "");
  ok("PL8 undeclared action rejected visibly", deniedText.includes("未在 permissions.actions 声明"), deniedText.slice(-200));
  const todosAfter = JSON.parse((await apiFetch(`/api/todos`)).body);
  ok("PL8 denied action created nothing", !todosAfter.some((t) => t.title === titleB));

  // 清理
  for (const id of [idA, idB]) {
    await apiFetch(`/api/plugins/${id}`, { method: "DELETE" });
  }
  const left = JSON.parse((await apiFetch("/api/plugins")).body);
  ok("PL8 uninstall cleanup", left.every((p) => !String(p.type).startsWith("pl8-")));
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
