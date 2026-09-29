import type { Db } from "../db/client.ts";
import { dashboard, LAYOUT_SCHEMA_VERSION, user } from "../db/schema.ts";

/** J1: default "首页" dashboard with example widgets, seeded once after account
 *  creation so first login lands on a usable page (M1-④). */
const DEFAULT_LAYOUT = JSON.stringify([
  { id: "seed-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
  { id: "seed-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
  { id: "seed-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
]);

export async function seedDefaultDashboard(db: Db): Promise<void> {
  const users = await db.select({ id: user.id }).from(user).limit(1);
  const userId = users[0]?.id;
  if (!userId) return;

  const existing = await db.select({ id: dashboard.id }).from(dashboard).limit(1);
  if (existing.length > 0) return;

  await db.insert(dashboard).values({
    id: crypto.randomUUID(),
    userId,
    title: "首页",
    icon: null,
    sortOrder: 0,
    layoutJson: DEFAULT_LAYOUT,
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
