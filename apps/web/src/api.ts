export type Dashboard = {
  id: string;
  title: string;
  icon: string | null;
  sortOrder: number;
  layoutJson: string;
  schemaVersion: number;
  createdAt: number | string;
  updatedAt: number | string;
};

export type Me = { id: string; username: string };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const api = {
  me: () => req<Me>("GET", "/api/auth/me"),
  login: (username: string, password: string) =>
    req<Me>("POST", "/api/auth/login", { username, password }),
  logout: () => req<{ ok: boolean }>("POST", "/api/auth/logout"),
  listDashboards: () => req<Dashboard[]>("GET", "/api/dashboards"),
  createDashboard: (title: string) => req<Dashboard>("POST", "/api/dashboards", { title }),
  patchDashboard: (id: string, patch: Partial<Pick<Dashboard, "title" | "layoutJson">>) =>
    req<Dashboard>("PATCH", `/api/dashboards/${id}`, patch),
  saveLayout: (id: string, layoutJson: string) =>
    req<Dashboard>("PUT", `/api/dashboards/${id}/layout`, { layoutJson }),
  deleteDashboard: (id: string) => req<{ ok: boolean }>("DELETE", `/api/dashboards/${id}`),
};
