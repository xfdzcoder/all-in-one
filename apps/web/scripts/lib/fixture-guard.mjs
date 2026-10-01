/**
 * TST-19 / ⑬（Q97b）：布局**快照与还原** —— verify/capture 脚本不得在真机/开发盘上留测试卡片。
 *
 * 用法（puppeteer 脚本，两行接入、不带变量）：
 *   import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
 *   // 登录成功、`.grid-stack` 就绪之后、任何布局改动之前：
 *   await installLayoutGuard(page);
 *   // 收尾（browser.close() 之前）：
 *   await restoreLayouts(page).catch((e) => console.error("!! 布局还原失败（TST-19）：", e?.message ?? e));
 *
 * 语义：还原 = ① 删掉脚本新建的页面（不在快照里）② 逐页 PUT 回快照布局。
 * **崩溃路径也兜**：installLayoutGuard 注册 uncaughtException/unhandledRejection 钩子，
 * 脚本中途抛错时先还原布局再退出（修好前真实发生过：verify-m1 崩溃把 seed 布局留在盘上）。
 * 页面删除类用例请只删脚本自建的页（快照里的页删了也会被重建布局，但标题/顺序不保证复原）。
 */

let snap = null;

/** 测前快照：全部页面的 id/title/layoutJson（内部持有，避免调用方作用域问题）。 */
export async function installLayoutGuard(page) {
  snap = await page.evaluate(async () => {
    const list = await (await fetch("/api/dashboards")).json();
    return list.map((d) => ({ id: d.id, title: d.title, layoutJson: d.layoutJson ?? "[]" }));
  });
  const onCrash = async (e) => {
    console.error("!! 脚本异常，尝试还原布局（TST-19）：", e?.message ?? e);
    await restoreLayouts(page).catch(() => {});
    process.exit(1);
  };
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);
  return snap;
}

/** 测后还原：删新建页 + 逐页 PUT 回快照布局。返回还原后的页面数。 */
export async function restoreLayouts(page) {
  if (!snap) throw new Error("restoreLayouts: 未先调用 installLayoutGuard");
  return page.evaluate(async (snapshot) => {
    const now = await (await fetch("/api/dashboards")).json();
    for (const d of now) {
      if (!snapshot.some((s) => s.id === d.id)) {
        await fetch(`/api/dashboards/${d.id}`, { method: "DELETE" });
      }
    }
    for (const s of snapshot) {
      await fetch(`/api/dashboards/${s.id}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutJson: s.layoutJson }),
      });
    }
    const after = await (await fetch("/api/dashboards")).json();
    return after.length;
  }, snap);
}
