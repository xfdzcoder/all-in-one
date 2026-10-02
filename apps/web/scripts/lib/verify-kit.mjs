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
