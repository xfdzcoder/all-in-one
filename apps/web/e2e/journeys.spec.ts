import { expect, test, type Page } from "@playwright/test";

/** J1–J4 旅程（D15：Playwright 全绿 = MVP 出口门槛）。
 *  前置：server :3000（ADMIN_PASSWORD=m1-e2e-pass）+ preview :4173。
 */

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel(/用户名/).fill("admin");
  await page.getByLabel(/口令/).fill(process.env.ADMIN_PASSWORD ?? "m1-e2e-pass");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForSelector(".grid-stack", { timeout: 15_000 });
}

test("J1 first-run: login lands on default dashboard with example widgets", async ({ page }) => {
  await login(page);
  // 默认首页 + 示例组件（含 D8 首版 todo/rss）
  await expect(page.locator(".grid-stack-item").first()).toBeVisible({ timeout: 10_000 });
  const count = await page.locator(".grid-stack-item").count();
  expect(count).toBeGreaterThanOrEqual(3);
  await expect(page.getByText("个人工作台")).toBeVisible();
});

test("J2 edit → drag → auto-save → reload restores layout", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "编辑布局" }).click();
  await page.waitForTimeout(400);

  const item = page.locator('.grid-stack-item[gs-id="seed-1"]');
  const before = await item.getAttribute("gs-y");
  const box = (await item.boundingBox())!;
  // 拖向下方空白区（避开 50% 碰撞规则）
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + i * 55);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  const moved = await item.getAttribute("gs-y");
  expect(moved).not.toBe(before); // 真实位移（非空洞断言）

  // 防抖 800ms 自动保存 → 刷新恢复
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector(".grid-stack", { timeout: 15_000 });
  await page.waitForTimeout(500);
  const restored = await page.locator('.grid-stack-item[gs-id="seed-1"]').getAttribute("gs-y");
  expect(restored).toBe(moved);
});

test("J2b add widget persists with props after reload", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "编辑布局" }).click();
  await page.waitForTimeout(400);
  const before = await page.locator(".grid-stack-item").count();
  await page.getByRole("button", { name: "添加组件" }).click();
  await page.waitForTimeout(400);
  await page.waitForTimeout(1500); // debounce save
  await page.reload();
  await page.waitForSelector(".grid-stack", { timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(await page.locator(".grid-stack-item").count()).toBe(before + 1);
});

test("J3 mobile: reflow, browse+operate, no edit entry, touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await login(page);
  // 无横向溢出
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  // D10：无编辑入口
  await expect(page.getByRole("button", { name: "编辑布局" })).toHaveCount(0);
  // NFR2：触控目标 ≥44px
  const small = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a[href], input, [role='checkbox']")].filter(
      (e) => e.getBoundingClientRect().height > 0,
    );
    return els.filter((e) => e.getBoundingClientRect().height < 44).length;
  });
  expect(small).toBe(0);
  // 组件内操作：Todo 新增（按专属 placeholder 定位，scoped 到同一 widget）
  const todoBox = page
    .locator(".grid-stack-item")
    .filter({ has: page.locator('input[placeholder="新任务…"]') })
    .first();
  await todoBox.locator('input[placeholder="新任务…"]').fill("手机任务");
  await todoBox.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("手机任务")).toBeVisible({ timeout: 5000 });
});

test("J4 data/view separation: two todo widgets share Workspace state", async ({ page }) => {
  await login(page);
  // 页面 A：添加 Todo（filter=open）并新建任务
  await page.getByRole("button", { name: "编辑布局" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "添加 Todo" }).click();
  await page.waitForTimeout(800);

  const title = `J4-${Date.now().toString(36)}`;
  const todoA = page
    .locator(".grid-stack-item")
    .filter({ has: page.locator('input[placeholder="新任务…"]') })
    .last();
  await todoA.locator('input[placeholder="新任务…"]').fill(title);
  await todoA.getByRole("button", { name: "添加", exact: true }).click();
  await expect(todoA.getByText(title)).toBeVisible({ timeout: 5000 });

  // 页面 B：新建页面 + Todo 组件 → 无需刷新即可见（SSE + 查询缓存）
  const uniq = `J4-${Date.now().toString(36).slice(-4)}`;
  await page.getByPlaceholder("新页面名").fill(uniq);
  await page.getByRole("button", { name: "新建页面" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "编辑布局" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "添加 Todo" }).click();
  await page.waitForTimeout(1500);
  const todoB = page
    .locator(".grid-stack-item")
    .filter({ has: page.locator('input[placeholder="新任务…"]') })
    .last();
  await expect(todoB.getByText(title)).toBeVisible({ timeout: 8000 });

  // 勾选完成（Mantine 隐藏原生 input，force 点击触发 change）→ 任务离开 open 列表
  // 目标行 = li 且含任务标题；Mantine 隐藏原生 checkbox → force click
  const row = page.locator(".grid-stack-item li").filter({ hasText: title }).last();
  await row.locator('input[type="checkbox"]').click({ force: true });
  await expect(todoB.getByText(title)).toBeHidden({ timeout: 8000 });

  // 切回页面 A：完成态同步（同一 Workspace 数据 —— 任务带删除线显示）
  await page.getByRole("tab", { name: "首页" }).click();
  await page.waitForTimeout(800);
  const doneOnA = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".grid-stack-item p")];
    return rows.some((r) => (r.textContent ?? "").includes("J4-") && r.style.textDecoration.includes("line-through"));
  });
  expect(doneOnA).toBe(true);
});
