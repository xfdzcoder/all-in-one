import { z } from "zod";

/** D11: zod is the single source for request schemas (OpenAPI generated from these). */

export const loginBody = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

/** FR-S2（Q110）：改用户名 / 改密码 —— 都**必须验证当前密码**（忘记走 ADMIN_PASSWORD 重置流程）。 */
export const changeUsernameBody = z.object({
  currentPassword: z.string().min(1).max(256),
  username: z.string().min(1).max(128),
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  /** 新口令长度下限与 `loginBody` 一致（1–256）：系统现有语义是 env 建号/登录都不设下限，
   *  UI 只给「建议至少 8 位」提示。是否强制 ≥8 待用户拍板（07 待确认 #8）。 */
  newPassword: z.string().min(1).max(256),
});

/** layoutJson = JSON text of gridstack widget list (Dashboard owns layout only). */
const layoutJsonSchema = z
  .string()
  .max(2_000_000)
  .refine((s) => {
    try {
      return Array.isArray(JSON.parse(s));
    } catch {
      return false;
    }
  }, "layoutJson must be a JSON array string");

/**
 * Q91（D58）：网格列数档位。
 * **列数本身不必是 4 的倍数**（gridstack `column` 接受任意正整数）；取 4 的倍数只为
 * 响应式断点 `N → N/2 → N/4 → 1` 取半/取四分之一时都是整数。
 * 前端 `apps/web` 有一份同值常量供渲染下拉 —— 服务端这份才是权威校验。
 */
export const DASHBOARD_COLUMNS = [12, 16, 20, 24, 28, 32] as const; // 导出给 CON-6 同步守卫测试对账

const dashboardColumns = z.union([
  z.literal(DASHBOARD_COLUMNS[0]),
  z.literal(DASHBOARD_COLUMNS[1]),
  z.literal(DASHBOARD_COLUMNS[2]),
  z.literal(DASHBOARD_COLUMNS[3]),
  z.literal(DASHBOARD_COLUMNS[4]),
  z.literal(DASHBOARD_COLUMNS[5]),
]);

/** Q91（D58）：行高 px。行数不限、纵向滚动。 */
const dashboardCellHeight = z.number().int().min(40).max(200);

export const dashboardCreateBody = z.object({
  title: z.string().min(1).max(200),
  icon: z.string().max(200).nullish(),
  columns: dashboardColumns.optional(),
  cellHeight: dashboardCellHeight.optional(),
});

export const dashboardPatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    icon: z.string().max(200).nullish(),
    /** 页面背景色（FR-P9）：任意 CSS 颜色串，空 = 回落默认底色。 */
    background: z.string().max(64).nullish(),
    sortOrder: z.number().int().min(0).optional(),
    layoutJson: layoutJsonSchema.optional(),
    /** Q91（D58）：页面级网格粒度配置。 */
    columns: dashboardColumns.optional(),
    cellHeight: dashboardCellHeight.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");

export const idParams = z.object({ id: z.string().min(1).max(64) });

/** Body for PUT /api/dashboards/:id/layout (M1-⑤ auto-save target). */
export const layoutUpdateBody = z.object({ layoutJson: layoutJsonSchema });

export type DashboardCreateBody = z.infer<typeof dashboardCreateBody>;
export type DashboardPatchBody = z.infer<typeof dashboardPatchBody>;

/** FR-S3（Q111/D70）：自定义 CSS 保存 / 回滚（备份 id 严格白名单，防路径穿越）。 */
export const cssSaveBody = z.object({ css: z.string().max(256_000) });
export const cssRestoreBody = z.object({ id: z.string().regex(/^[\w.-]{1,80}$/) });
