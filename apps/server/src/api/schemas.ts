import { z } from "zod";

/** D11: zod is the single source for request schemas (OpenAPI generated from these). */

export const loginBody = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

/** layoutJson = JSON text of gridstack widget list (Dashboard owns layout only). */
export const layoutJsonSchema = z
  .string()
  .max(2_000_000)
  .refine((s) => {
    try {
      return Array.isArray(JSON.parse(s));
    } catch {
      return false;
    }
  }, "layoutJson must be a JSON array string");

export const dashboardCreateBody = z.object({
  title: z.string().min(1).max(200),
  icon: z.string().max(200).nullish(),
});

export const dashboardPatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    icon: z.string().max(200).nullish(),
    /** 页面背景色（FR-P9）：任意 CSS 颜色串，空 = 回落默认底色。 */
    background: z.string().max(64).nullish(),
    sortOrder: z.number().int().min(0).optional(),
    layoutJson: layoutJsonSchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "empty patch");

export const idParams = z.object({ id: z.string().min(1).max(64) });

/** Body for PUT /api/dashboards/:id/layout (M1-⑤ auto-save target). */
export const layoutUpdateBody = z.object({ layoutJson: layoutJsonSchema });

export type LoginBody = z.infer<typeof loginBody>;
export type DashboardCreateBody = z.infer<typeof dashboardCreateBody>;
export type DashboardPatchBody = z.infer<typeof dashboardPatchBody>;
