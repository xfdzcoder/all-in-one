/**
 * verify 脚本公共库（**TST-14/15/17 收口**）。
 *
 * 此前 40 个脚本各自手抄 `ok`/`sleep`/登录块/apiFetch，口令明文散落 36 处
 * （TST-17），helper 返回值无契约（返回「失败原因」字符串会被 truthy 吞成假绿，
 * TST-15）。这里收口为唯一实现：
 *
 * - **口令单点** `ADMIN_PASSWORD`（env 优先，缺省回落开发默认值 —— D17 只约束服务端首启）；
 * - **`makeOk(results)`** 统一 `(name, pass, detail)` 签名与输出格式；
 * - **helper 必须返回布尔**（clickBtn/selectOption/login…）—— 非布尔第二参会被点名告警，
 *   杜绝「return 失败原因字符串」型假绿；
 * - `login(page)` 登录块一处维护（选择器变更只改这里）。
 */

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "m1-e2e-pass";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 统一断言记账：`(name, pass, detail)` —— pass 应为布尔（TST-15 契约）。 */
export function makeOk(results) {
  return (name, pass, detail = "") => {
    if (typeof pass !== "boolean") {
      console.log(`!! ok() 第二参非布尔（${typeof pass}）：「${name}」—— helper 请返回布尔（TST-15）`);
    }
    const p = Boolean(pass);
    results.push({ name, pass: p, detail });
    console.log(`${p ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  };
}

/** 收尾汇总：打印 `N/M passed`，返回是否全绿（exit code 用）。 */
export function summarize(results) {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  return failed.length === 0;
}

/** 登录（页面已在 WEB 上）：选择器/流程只此一处（TST-14）。 */
export async function login(page) {
  await page.waitForSelector("input[autocomplete=username]", { timeout: 8000 });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[autocomplete=current-password]", ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector(".grid-stack", { timeout: 8000 });
}

/** 同源 fetch（带会话 cookie）——body 传**已序列化字符串**（TST-14；传对象会被 fetch 当 "[object Object]"）。 */
export function makeApiFetch(page) {
  return (path, options = {}) =>
    page.evaluate(
      async ({ p, o }) => {
        const res = await fetch(p, {
          method: o.method ?? "GET",
          body: o.body,
          credentials: "same-origin",
          // 无 body 不发 Content-Type（Fastify 空 JSON body 会 400）
          headers: o.body ? { "Content-Type": "application/json" } : undefined,
        });
        return { status: res.status, body: await res.text() };
      },
      { p: path, o: options },
    );
}

/**
 * 唯一命名后缀（**TST-8**）：时间戳 + 随机段。
 * 原 `Date.now().toString(36).slice(-4)` 同毫秒并发会重名、且只增不减地留残留行。
 */
export const uniqId = (prefix = "") =>
  `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * 按钮点击（**TST-12/TST-14**）：匹配优先级 = 精确文本 → aria-label 精确 → 包含匹配。
 * 原实现默认「首个包含命中」——「添加」会命中「添加组件」这类**首个匹配陷阱**；
 * 精确优先把陷阱消解在匹配序里，`exact=true` 时禁用包含回落。返回布尔（TST-15 契约）。
 */
export function makeClickBtn(page) {
  return (label, exact = false) =>
    page.evaluate(
      ({ l, ex }) => {
        const btns = [...document.querySelectorAll("button")];
        const hit =
          btns.find((b) => b.textContent.trim() === l) ??
          btns.find((b) => (b.getAttribute("aria-label") ?? "").trim() === l) ??
          (ex ? undefined : btns.find((b) => b.textContent.trim().includes(l)));
        if (!hit) return false;
        hit.click();
        return true;
      },
      { l: label, ex: exact },
    );
}

/**
 * 轮询等待（**TST-13**）：以**条件**而非固定毫秒同步异步渲染。
 * 原 `sleep(1200)`/`sleep(1500)` 魔法数 = 慢机假红、快机假绿、同帧读结果是确定性竞态。
 * `fn` 在页面上下文执行（page.evaluate 语义，arg 传参），返回真即达成；超时返回 false（TST-15 契约）。
 */
export async function waitFor(page, fn, arg, { timeoutMs = 8000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
}

/** 文本出现/消失等待（TST-13 常用形态）。 */
export const waitForText = (page, text, { present = true, timeoutMs = 8000 } = {}) =>
  waitFor(
    page,
    (t) => ((document.body.textContent ?? "").includes(t.text) === t.present),
    { text, present },
    { timeoutMs },
  );

// ── 临时草稿盘（**TST-23**：verify 脚本零接触用户页面）────────────────────
//
// 背景（用户反馈②，2026-10-02）：历史脚本普遍 `find(title === "首页") ?? list[0]`
// 回落**首个页面**再重置其布局 —— 用户把页面1改名「用户页面禁止修改」后，回落
// 正打到它头上。收口为唯一模式：**脚本只准写自己创建的临时草稿盘**（标题带
// `tmp-verify-` 前缀），自建自删；护栏对非草稿盘/受保护标题一律抛错，杜绝回落。

/** 草稿盘标题前缀 —— 脚本自建盘的唯一识别（守卫按它放行）。 */
export const SCRATCH_PREFIX = "tmp-verify-";

/** 用户明令禁止触碰的页面标题（硬护栏，见 assertScratchTitle）。 */
export const PROTECTED_DASH_TITLES = ["用户页面禁止修改"];

/** 唯一草稿盘标题（同轮多盘不撞名）。 */
export const scratchTitle = () => `${SCRATCH_PREFIX}${uniqId()}`;

export const isScratchTitle = (title) => String(title ?? "").startsWith(SCRATCH_PREFIX);

/**
 * 护栏（TST-23）：布局写入/加卡前断言目标是**本轮自建草稿盘**。
 * 非草稿盘（含「首页」等历史回落目标）与受保护页面一律抛错 —— 宁可脚本红，不可动用户盘。
 */
export function assertScratchTitle(title) {
  const t = String(title ?? "");
  if (PROTECTED_DASH_TITLES.includes(t)) {
    throw new Error(`拒绝操作受保护页面「${t}」—— verify 脚本只准使用临时草稿盘（${SCRATCH_PREFIX}*），请勿回落 list[0]`);
  }
  if (!isScratchTitle(t)) {
    throw new Error(`拒绝操作非草稿盘「${t}」—— 请用 createScratchDashboard 自建临时盘（${SCRATCH_PREFIX}*），不要写既有页面`);
  }
}

/** 建临时草稿盘（标题强制前缀）。返回创建行（含 id/title）。 */
export async function createScratchDashboard(apiFetch, title = scratchTitle()) {
  assertScratchTitle(title);
  const r = await apiFetch("/api/dashboards", { method: "POST", body: JSON.stringify({ title }) });
  if (r.status !== 201) throw new Error(`创建临时草稿盘失败：HTTP ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}

/** 删临时草稿盘（不存在视为成功，幂等）。 */
export async function deleteScratchDashboard(apiFetch, id) {
  const r = await apiFetch(`/api/dashboards/${id}`, { method: "DELETE" });
  if (r.status !== 200 && r.status !== 404) throw new Error(`删除临时草稿盘失败：HTTP ${r.status} ${r.body}`);
  return true;
}

/**
 * 临时盘生命周期：创建 → `fn(dash)` → **无论成败删除**。
 * 测挂了也不留盘；删除失败打印告警（需手工删），不吞测试结论。
 */
export async function withScratchDashboard(apiFetch, fn) {
  const dash = await createScratchDashboard(apiFetch);
  try {
    return await fn(dash);
  } finally {
    await deleteScratchDashboard(apiFetch, dash.id).catch((e) =>
      console.error(`!! 临时草稿盘清理失败，需手工删除：${dash.id} ${dash.title}`, e?.message ?? e),
    );
  }
}
