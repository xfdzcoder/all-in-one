/**
 * FR-W4 acceptance (生命周期·配置变更): edit an EXISTING widget's configSchema
 *  config through the per-widget 配置 entry (WidgetChrome) —
 *  ① 编辑态显示配置入口、浏览态隐藏（FR-P7/P8、D10）；
 *  ② 表单预填当前 props → 保存后组件立即生效；
 *  ③ 配置随布局持久化（刷新后保持）；
 *  ④ text 与 select 字段均可改（数据/视图分离的清单/过滤配置）。
 * 说明：实例定位一律用 gridstack gs-id（id 差集确定本轮新增组件），避免 DOM 顺序
 * 在多轮累积布局下的漂移；Workspace/布局数据跨轮累积，标题带轮次唯一后缀。
 * Run: node scripts/verify-w4.mjs (server :3000, preview :4173)
 */
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:4173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-4);

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

const nodeIds = () =>
  page.evaluate(() =>
    (document.querySelector(".grid-stack")?.gridstack?.engine?.nodes ?? []).map((n) => String(n.id)),
  );

/** 点击指定 gs-id 组件内的按钮。 */
const clickItemBtn = (id, label) =>
  page.evaluate(
    ({ wantId, l }) => {
      const item = document.querySelector(`.grid-stack-item[gs-id="${wantId}"]`);
      const btn = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === l);
      if (!btn) return false;
      btn.click();
      return true;
    },
    { wantId: id, l: label },
  );

/** 多 Modal 并存时各自持有 .mantine-Modal-root（关闭态留空壳），按字段跨全部 root 查找。 */
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

const readField = (label) =>
  page.evaluate((l) => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes(l),
    );
    return wrapper?.querySelector("input, textarea")?.value ?? null;
  }, label);

const _selectOption = async (label, optionText) => {
  const clicked = await page.evaluate((l) => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes(l),
    );
    wrapper?.querySelector("[role=combobox]")?.click();
    return Boolean(wrapper);
  }, label);
  await sleep(400);
  const picked = await page.evaluate((o) => {
    const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) => e.textContent.includes(o));
    opt?.click();
    return Boolean(opt);
  }, optionText);
  await sleep(300);
  return clicked && picked;
};

const propsOf = (id) =>
  page.evaluate(
    (wantId) =>
      document.querySelector(".grid-stack")?.gridstack?.engine?.nodes?.find((n) => String(n.id) === wantId)?.props ??
      null,
    id,
  );

/** 选择器 → 选组件 → 表单（可选填充）→ 确认添加；返回新增实例的 gs-id。 */
const addViaPicker = async (name, before, fillLabel, fillValue) => {
  if (!(await clickBtn("添加组件"))) return null;
  await sleep(300);
  if (!(await clickBtn(name))) return null;
  await sleep(400);
  if (fillLabel) {
    // Q29b：名称为 creatable Select —— 点击展开 → 键入 → 点「＋ 新建」选项
    await page.evaluate((l) => {
      const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
        w.querySelector("label")?.textContent.includes(l),
      );
      wrapper?.querySelector("input")?.focus();
    }, fillLabel);
    await sleep(250);
    await page.keyboard.type(fillValue);
    await sleep(350);
    await page.evaluate((v) => {
      const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) =>
        e.textContent.includes(`新建「${v}」`),
      );
      opt?.click();
    }, fillValue);
    await sleep(250);
  }
  if (!(await clickBtn("确认添加", true))) return null;
  await sleep(800);
  const after = await nodeIds();
  const fresh = after.filter((id) => !before.includes(id));
  return fresh.at(-1) ?? null;
};

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });

  const oldTitle = `W4-旧-${uniq}`;
  const newTitle = `W4-新-${uniq}`;
  ok("W4 enter edit", await clickBtn("编辑页面"));
  await sleep(300);

  // ① ② ③ text 字段配置变更（占位组件标题）
  const before1 = await nodeIds();
  const phId = await addViaPicker("占位组件", before1, "标题", oldTitle);
  ok("W4 add placeholder widget", Boolean(phId), String(phId));
  ok("W4 config entry visible in edit mode", await clickItemBtn(phId, "配置"));
  await sleep(400);
  const prefill = await readField("标题");
  ok("W4 form prefilled with current props", String(prefill).includes(oldTitle), String(prefill));
  ok("W4 change title via configSchema form", await setField("标题", newTitle));
  await sleep(200);
  ok("W4 save config", await clickBtn("保存配置", true));
  await sleep(800);
  ok(
    "W4 change applies immediately",
    await page.evaluate((t) => document.body.textContent.includes(t), newTitle),
    newTitle,
  );
  ok("W4 changed props on node (ground truth)", (await propsOf(phId))?.title === newTitle, JSON.stringify(await propsOf(phId)));

  // ④ 文本字段配置变更（Todo 名称 = 任务分组名，D43）
  const before2 = await nodeIds();
  const todoId = await addViaPicker("个人 Todo", before2, "名称", `W4组-${uniq}`);
  ok("W4 add todo widget", Boolean(todoId), String(todoId));
  ok("W4 open todo config form", await clickItemBtn(todoId, "配置"));
  await sleep(400);
  const renamed2 = `W4改-${uniq}`;
  await page.evaluate(() => {
    const wrapper = [...document.querySelectorAll(".mantine-Modal-root .mantine-InputWrapper-root")].find((w) =>
      w.querySelector("label")?.textContent.includes("名称"),
    );
    const input = wrapper?.querySelector("input");
    input?.focus();
    input?.select();
  });
  await sleep(150);
  await page.keyboard.type(renamed2);
  await sleep(350);
  ok(
    "W4 change todo name",
    await page.evaluate((v) => {
      const opt = [...document.querySelectorAll("[data-combobox-option]")].find((e) =>
        e.textContent.includes(`新建「${v}」`),
      );
      opt?.click();
      return Boolean(opt);
    }, renamed2),
  );
  await sleep(250);
  ok("W4 save todo config", await clickBtn("保存配置", true));
  await sleep(800);
  ok("W4 todo props updated (ground truth)", (await propsOf(todoId))?.name === `W4改-${uniq}`, JSON.stringify(await propsOf(todoId)));
  ok("W4 reopen todo config", await clickItemBtn(todoId, "配置"));
  await sleep(400);
  const nameValue = await readField("名称");
  ok("W4 name change persisted (reopened form)", nameValue === `W4改-${uniq}`, String(nameValue));
  await clickBtn("保存配置", true); // close
  await sleep(300);

  // ① 浏览态隐藏配置入口（FR-P8/D10）
  ok("W4 exit edit", await clickBtn("完成编辑"));
  await sleep(300);
  const browseEntries = await page.evaluate(
    () => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "配置").length,
  );
  ok("W4 config entry hidden in browse mode", browseEntries === 0, `entries=${browseEntries}`);

  // ③ 配置随布局持久化（刷新后保持）
  await page.reload({ waitUntil: "domcontentloaded" }); // SSE long-poll keeps network busy
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
  await sleep(600);
  ok(
    "W4 config persists after reload",
    await page.evaluate((t) => document.body.textContent.includes(t), newTitle),
    newTitle,
  );
} catch (e) {
  ok("flow completed", false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
