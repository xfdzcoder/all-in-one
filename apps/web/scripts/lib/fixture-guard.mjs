/**
 * TST-19 / TST-21 / ⑬（Q97b/Q100e）：布局**与数据**的快照/还原 —— verify/capture 脚本
 * 不得在真机/开发盘上留测试卡片，也不得留测试数据（feed 源/标签/Todo/数据源/凭证/邮箱/看板）。
 *
 * 用法（puppeteer 脚本，两行接入、不带变量）：
 *   import { installLayoutGuard, restoreLayouts } from "./lib/fixture-guard.mjs";
 *   // 登录成功、`.grid-stack` 就绪之后、任何改动之前：
 *   await installLayoutGuard(page);
 *   // 收尾（browser.close() 之前）：
 *   await restoreLayouts(page).catch((e) => console.error("!! 还原失败（TST-19/21）：", e?.message ?? e));
 *
 * 语义：还原 = ① 删掉脚本新建的页面与数据实体（不在快照里）② 逐页 PUT 回快照布局。
 * **崩溃路径也兜**：installLayoutGuard 注册 uncaughtException/unhandledRejection 钩子，
 * 脚本中途抛错时先还原再退出（修好前真实发生过：verify-m1 崩溃把 seed 布局留在盘上）。
 * 页面删除类用例请只删脚本自建的页（快照里的页删了也会被重建布局，但标题/顺序不保证复原）。
 */

let snap = null;

/** 数据实体清单（TST-21：脚本创建这些但从不清理，逐轮累积污染 —— 实测 feed 源堆积数十条）。 */
const DATA_COLLECTIONS = [
  { list: "/api/feeds", del: (id) => `/api/feeds/${id}`, items: "items" },
  { list: "/api/tags", del: (id) => `/api/tags/${id}`, items: "direct" },
  { list: "/api/todos", del: (id) => `/api/todos/${id}`, items: "direct" },
  { list: "/api/data-sources", del: (id) => `/api/data-sources/${id}`, items: "direct" },
  { list: "/api/credentials", del: (id) => `/api/credentials/${id}`, items: "direct" },
  { list: "/api/mail/accounts", del: (id) => `/api/mail/accounts/${id}`, items: "direct" },
  { list: "/api/kanban/boards", del: (id) => `/api/kanban/boards/${id}`, items: "direct" },
];

/** 测前快照：全部页面（id/title/layoutJson）+ 各数据实体的 id 集合（内部持有，避免调用方作用域问题）。 */
export async function installLayoutGuard(page) {
  const dashboards = await page.evaluate(async () => {
    const list = await (await fetch("/api/dashboards")).json();
    return list.map((d) => ({ id: d.id, title: d.title, layoutJson: d.layoutJson ?? "[]" }));
  });
  const data = {};
  for (const c of DATA_COLLECTIONS) data[c.list] = await listIds(page, c);
  snap = { dashboards, data };
  const onCrash = async (e) => {
    console.error("!! 脚本异常，尝试还原（TST-19/21）：", e?.message ?? e);
    await restoreLayouts(page).catch(() => undefined);
    process.exit(1);
  };
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);
}

function listIds(page, c) {
  return page.evaluate(async (list, items) => {
    const raw = await (await fetch(list)).json();
    const rows = items === "direct" ? raw : (raw?.items ?? []);
    return rows.map((r) => String(r.id ?? "")).filter(Boolean);
  }, c.list, c.items);
}

/** 测后还原：删脚本新建的数据实体与页面 + 逐页 PUT 回快照布局。返回还原后的页面数。 */
export async function restoreLayouts(page) {
  if (!snap) throw new Error("restoreLayouts: 未先调用 installLayoutGuard");
  const current = snap;
  return page.evaluate(async (s) => {
    const collections = [
      { list: "/api/feeds", del: (id) => `/api/feeds/${id}`, items: "items" },
      { list: "/api/tags", del: (id) => `/api/tags/${id}`, items: "direct" },
      { list: "/api/todos", del: (id) => `/api/todos/${id}`, items: "direct" },
      { list: "/api/data-sources", del: (id) => `/api/data-sources/${id}`, items: "direct" },
      { list: "/api/credentials", del: (id) => `/api/credentials/${id}`, items: "direct" },
      { list: "/api/mail/accounts", del: (id) => `/api/mail/accounts/${id}`, items: "direct" },
      { list: "/api/kanban/boards", del: (id) => `/api/kanban/boards/${id}`, items: "direct" },
    ];
    // ① 数据实体：删掉不在快照里的（脚本创建的）
    for (const c of collections) {
      const raw = await (await fetch(c.list)).json();
      const rows = c.items === "direct" ? raw : (raw?.items ?? []);
      const before = new Set(s.data[c.list] ?? []);
      for (const r of rows) {
        const id = String(r.id ?? "");
        if (id && !before.has(id)) await fetch(c.del(id), { method: "DELETE" });
      }
    }
    // ② 页面：删脚本新建的 + 逐页还原布局
    const now = await (await fetch("/api/dashboards")).json();
    for (const d of now) {
      if (!s.dashboards.some((x) => x.id === d.id)) {
        await fetch(`/api/dashboards/${d.id}`, { method: "DELETE" });
      }
    }
    for (const x of s.dashboards) {
      await fetch(`/api/dashboards/${x.id}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutJson: x.layoutJson }),
      });
    }
    const after = await (await fetch("/api/dashboards")).json();
    return after.length;
  }, current);
}
