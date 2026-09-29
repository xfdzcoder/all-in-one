import { z } from "zod";

import {
  dashboardCreateBody,
  dashboardPatchBody,
  layoutJsonSchema,
  loginBody,
} from "./schemas.ts";

function body(schema: z.ZodType, description: string) {
  return {
    required: true,
    description,
    content: { "application/json": { schema: z.toJSONSchema(schema) } },
  };
}

/** D11: OpenAPI 3.1 doc generated from the same zod schemas the routes validate with. */
export const openApiDoc = {
  openapi: "3.1.0",
  info: {
    title: "all-in-one API",
    version: "0.1.0",
    description: "Workbench REST API (session cookie auth: `sid`).",
  },
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "sid" },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    "/api/health": {
      get: { summary: "Health check", security: [], responses: { "200": { description: "ok" } } },
    },
    "/api/auth/login": {
      post: {
        summary: "Login, sets session cookie",
        security: [],
        requestBody: body(loginBody, "credentials"),
        responses: {
          "200": { description: "current user" },
          "401": { description: "invalid credentials" },
        },
      },
    },
    "/api/auth/logout": {
      post: { summary: "Logout, revokes session", responses: { "200": { description: "ok" } } },
    },
    "/api/auth/me": {
      get: {
        summary: "Current user",
        responses: { "200": { description: "user" }, "401": { description: "unauthorized" } },
      },
    },
    "/api/dashboards": {
      get: { summary: "List dashboards", responses: { "200": { description: "rows" } } },
      post: {
        summary: "Create dashboard",
        requestBody: body(dashboardCreateBody, "dashboard"),
        responses: { "201": { description: "created row" } },
      },
    },
    "/api/dashboards/{id}": {
      patch: {
        summary: "Update dashboard (title/icon/sortOrder/layoutJson)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: body(dashboardPatchBody, "partial update"),
        responses: {
          "200": { description: "updated row" },
          "404": { description: "not found" },
        },
      },
      delete: {
        summary: "Delete dashboard",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok" }, "404": { description: "not found" } },
      },
    },
    "/api/dashboards/{id}/layout": {
      put: {
        summary: "Save layout (debounced auto-save target)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: body(z.object({ layoutJson: layoutJsonSchema }), "layout document"),
        responses: { "200": { description: "updated row" }, "404": { description: "not found" } },
      },
    },
  },
} as const;
