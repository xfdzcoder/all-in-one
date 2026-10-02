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
