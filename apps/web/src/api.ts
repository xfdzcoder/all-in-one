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

export type TodoItem = {
  id: string;
  list: string;
  title: string;
  done: boolean;
  sortOrder: number;
  createdAt: number | string;
  updatedAt: number | string;
};

export type FeedItem = {
  title: string;
  link: string;
  summary: string;
  date: string;
  itemKey: string;
  sourceTitle: string;
  read: boolean;
};

export type FeedSource = {
  id: string;
  title: string;
  url: string;
  createdAt: number | string;
};

export type FeedAgg = {
  items: FeedItem[];
  unread: number;
  sourceCount: number;
  errors: Array<{ title: string; error: string }>;
};

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
  listTodos: (list?: string) =>
    req<TodoItem[]>("GET", `/api/todos${list ? `?list=${encodeURIComponent(list)}` : ""}`),
  createTodo: (title: string, list = "inbox") =>
    req<TodoItem>("POST", "/api/todos", { title, list }),
  patchTodo: (id: string, patch: { done?: boolean; title?: string }) =>
    req<TodoItem>("PATCH", `/api/todos/${id}`, patch),
  deleteTodo: (id: string) => req<{ ok: boolean }>("DELETE", `/api/todos/${id}`),
  widgetData: (type: string, config: Record<string, unknown>, force = false) =>
    req<unknown>("POST", "/api/widgets/data", { type, config, force }).then((r) => (r as { data: unknown }).data),
  createCredential: (name: string, secret: string, kind = "http-header") =>
    req<{ id: string; name: string }>("POST", "/api/credentials", { name, kind, secret }),
  listFeeds: () => req<FeedSource[]>("GET", "/api/feeds"),
  createFeed: (title: string, url: string) => req<FeedSource>("POST", "/api/feeds", { title, url }),
  deleteFeed: (id: string) => req<{ ok: boolean }>("DELETE", `/api/feeds/${id}`),
  markFeedRead: (itemKey: string) => req<{ ok: boolean }>("POST", "/api/feeds/read", { itemKey }),
};
