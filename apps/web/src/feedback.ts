/**
 * WEB-4/WEB-6（Q99d）：**失败反馈统一入口**。
 *
 * 此前大量 `void promise.then(...)` 没有 `.catch()`（unhandled rejection、UI 零反馈）、
 * `useMutation` 全部未接 `onError` —— 勾选、增删卡、打标签失败**静默**，界面看似成功。
 * 统一走 `reportError`：控制台留痕 + `wb:error` 事件 → App 顶栏 WbAlert 可见反馈。
 *
 * 兜底层（`data-hooks.ts` 的 QueryClient 与 `installErrorNet()`）覆盖所有 mutation 与
 * 未接住的 Promise；调用点显式 `.catch(reportError(...))` 仍是正解（能给出操作上下文）。
 */
export function reportError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${context}]`, msg);
  window.dispatchEvent(new CustomEvent("wb:error", { detail: `${context}：${msg}` }));
}

/** 未接住的 Promise 拒绝也进反馈通道（安全网；根治仍靠调用点补 `.catch`）。 */
export function installErrorNet(): void {
  window.addEventListener("unhandledrejection", (e) => {
    reportError("未处理的异步失败", e.reason ?? e);
  });
}
