/**
 * Q91（D58）：网格列数档位。**服务端 `api/schemas.ts` 的同名常量才是权威校验**，这里供渲染下拉。
 * 取 4 的倍数只为响应式断点 `N → N/2 → N/4 → 1` 取半/取四分之一时都是整数（列数本身不必是 4 的倍数）。
 */
export const DASHBOARD_COLUMNS = [12, 16, 20, 24, 28, 32] as const;

export type Dashboard = {
  id: string;
  title: string;
  icon: string | null;
  background: string | null;
  /** Q91（D58）：网格列数档位 12/16/20/24/28/32（页面级布局配置）。 */
  columns: number;
  /** Q91（D58）：行高 px（40–200）。 */
  cellHeight: number;
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
  /** Q29b：归档项不在组件显示。 */
  archived?: boolean;
  sortOrder: number;
  createdAt: number | string;
  updatedAt: number | string;
  /** FR-D1/D3：标签（服务端内嵌；组件按标签选数据）。 */
  tagIds?: string[];
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
  /** FR-D1/D3：标签（服务端内嵌；组件按标签选源）。 */
  tagIds?: string[];
};

/** 命名数据连接（D42）。 */
export type DataSourceRow = {
  id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: number | string;
  updatedAt: number | string;
};

/** 自定义图标（Q38b/D45）：文件在服务端 dataDir/icons，引用 = /api/icons/:id 或 custom:<id>。 */
export type IconRow = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number | string;
};

/** Workspace 标签（FR-D1 / D40）。 */
export type TagRow = {
  id: string;
  name: string;
  color: string | null;
  targetCount: number;
};

export type FeedAgg = {
  items: FeedItem[];
  unread: number;
  sourceCount: number;
  /** Q29c/二.1：拉取失败但用本地快照兜底的源。 */
  staleSources?: string[];
  errors: Array<{ title: string; error: string }>;
};

/** 插件登记行（FR-W6；manifestJson = D24 PluginManifest）。 */
export type PluginRow = {
  id: string;
  type: string;
  name: string;
  manifestJson: string;
  status: string;
  createdAt: string;
};

/** 邮件（Q7b）：只读聚合（D3）；账号密码只存凭证引用（SEC3）。 */
export type MailAccountRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  security: string;
  username: string;
  credentialId: string | null;
  folder: string;
};
export type MailListEntry = {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  accountId: string;
  accountName: string;
};
export type MailAgg = {
  items: MailListEntry[];
  errors: Array<{ accountId: string; accountName: string; error: string }>;
};
export type MailFull = MailListEntry & { text: string; html: string };

/** Kanban（Q6）：看板/列/卡，数据归 Workspace（D21）。 */
export type KanbanBoardRow = { id: string; title: string };
export type KanbanColumnRow = {
  id: string;
  boardId: string;
  title: string;
  sortOrder: number;
};
export type KanbanCardRow = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  body: string;
  archived: boolean;
  sortOrder: number;
};
export type KanbanTree = {
  board: KanbanBoardRow;
  columns: KanbanColumnRow[];
  cards: KanbanCardRow[];
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
  patchDashboard: (
    id: string,
    patch: Partial<
      Pick<Dashboard, "title" | "icon" | "background" | "sortOrder" | "layoutJson" | "columns" | "cellHeight">
    >,
  ) => req<Dashboard>("PATCH", `/api/dashboards/${id}`, patch),
  saveLayout: (id: string, layoutJson: string) =>
    req<Dashboard>("PUT", `/api/dashboards/${id}/layout`, { layoutJson }),
  deleteDashboard: (id: string) => req<{ ok: boolean }>("DELETE", `/api/dashboards/${id}`),
  listTodos: (list?: string, tagIds?: string[], includeArchived?: boolean) => {
    const q = new URLSearchParams();
    if (list) q.set("list", list);
    if (tagIds && tagIds.length > 0) q.set("tagIds", tagIds.join(","));
    if (includeArchived) q.set("includeArchived", "1");
    const qs = q.toString();
    return req<TodoItem[]>("GET", `/api/todos${qs ? `?${qs}` : ""}`);
  },
  createTodo: (title: string, list = "inbox") =>
    req<TodoItem>("POST", "/api/todos", { title, list }),
  deleteTodoGroup: (name: string) =>
    req<{ ok: boolean; deleted: number }>("POST", "/api/todos/delete-group", { name }),
  patchTodo: (id: string, patch: { done?: boolean; title?: string; archived?: boolean }) =>
    req<TodoItem>("PATCH", `/api/todos/${id}`, patch),
  deleteTodo: (id: string) => req<{ ok: boolean }>("DELETE", `/api/todos/${id}`),
  widgetData: (type: string, config: Record<string, unknown>, force = false) =>
    req<unknown>("POST", "/api/widgets/data", { type, config, force }).then((r) => (r as { data: unknown }).data),
  // ── 写操作深度组件（D51：专属 REST + 服务端审计；D54 起 Navidrome 遥控与 Mihomo 切换已移除，仅剩 Portainer 重启）──
  portainerRestart: (sourceId: string, containerId: string) =>
    req<{ ok: boolean; name: string }>("POST", "/api/portainer/restart", { sourceId, containerId }),
  createCredential: (name: string, secret: string, kind = "http-header") =>
    req<{ id: string; name: string }>("POST", "/api/credentials", { name, kind, secret }),
  // ── 命名数据连接（D42）：monitor / opencode / http ──
  listDataSources: (kind?: string) =>
    req<DataSourceRow[]>("GET", `/api/data-sources${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`),
  createDataSource: (v: { kind: string; name: string; config: Record<string, unknown> }) =>
    req<DataSourceRow>("POST", "/api/data-sources", v),
  updateDataSource: (
    id: string,
    patch: { name?: string; config?: Record<string, unknown> },
  ) => req<{ ok: boolean }>("PATCH", `/api/data-sources/${id}`, patch),
  deleteDataSource: (id: string) => req<{ ok: boolean }>("DELETE", `/api/data-sources/${id}`),
  // ── 自定义图标库（Q38b/D45）──
  listIcons: () => req<IconRow[]>("GET", "/api/icons"),
  createIcon: (v: { name: string; mime: string; dataBase64: string }) => req<IconRow>("POST", "/api/icons", v),
  deleteIcon: (id: string) => req<{ ok: boolean }>("DELETE", `/api/icons/${id}`),
  listFeeds: () => req<FeedSource[]>("GET", "/api/feeds"),
  // ── Workspace 标签（FR-D1/D2/D3，D40）──
  listTags: () => req<TagRow[]>("GET", "/api/tags"),
  createTag: (name: string, color?: string) => req<TagRow>("POST", "/api/tags", { name, color }),
  updateTag: (id: string, patch: { name?: string; color?: string | null }) =>
    req<{ ok: boolean }>("PATCH", `/api/tags/${id}`, patch),
  deleteTag: (id: string) => req<{ ok: boolean }>("DELETE", `/api/tags/${id}`),
  setTargetTags: (targetType: "todo" | "feed", targetId: string, tagIds: string[]) =>
    req<{ ok: boolean; tagIds: string[] }>("PUT", "/api/tags/targets", { targetType, targetId, tagIds }),
  createFeed: (title: string, url: string) => req<FeedSource>("POST", "/api/feeds", { title, url }),
  deleteFeed: (id: string) => req<{ ok: boolean }>("DELETE", `/api/feeds/${id}`),
  markFeedRead: (itemKey: string) => req<{ ok: boolean }>("POST", "/api/feeds/read", { itemKey }),
  listPlugins: () => req<PluginRow[]>("GET", "/api/plugins"),
  installPlugin: (packageBase64: string) => req<PluginRow>("POST", "/api/plugins", { packageBase64 }),
  uninstallPlugin: (id: string) => req<{ ok: boolean }>("DELETE", `/api/plugins/${id}`),
  setPluginStatus: (id: string, enabled: boolean) =>
    req<PluginRow>("POST", `/api/plugins/${id}/${enabled ? "enable" : "disable"}`),
  pluginAction: (id: string, name: string, params: unknown) =>
    req<{ ok: boolean; result: unknown }>("POST", `/api/plugins/${id}/actions`, { name, params }),
  getPluginEntry: (id: string) =>
    req<{ manifest: unknown; code: string }>("GET", `/api/plugins/${id}/entry`),
  listBoards: () => req<KanbanBoardRow[]>("GET", "/api/kanban/boards"),
  getBoardTree: (id: string) => req<KanbanTree>("GET", `/api/kanban/boards/${id}`),
  createBoard: (title: string) => req<KanbanBoardRow>("POST", "/api/kanban/boards", { title }),
  renameBoard: (id: string, title: string) =>
    req<KanbanBoardRow>("PATCH", `/api/kanban/boards/${id}`, { title }),
  deleteBoard: (id: string) => req<{ ok: boolean }>("DELETE", `/api/kanban/boards/${id}`),
  createColumn: (boardId: string, title: string) =>
    req<KanbanColumnRow>("POST", "/api/kanban/columns", { boardId, title }),
  renameColumn: (id: string, title: string) =>
    req<KanbanColumnRow>("PATCH", `/api/kanban/columns/${id}`, { title }),
  deleteColumn: (id: string) => req<{ ok: boolean }>("DELETE", `/api/kanban/columns/${id}`),
  createCard: (columnId: string, title: string) =>
    req<KanbanCardRow>("POST", "/api/kanban/cards", { columnId, title }),
  patchCard: (id: string, patch: Partial<Pick<KanbanCardRow, "title" | "body" | "columnId" | "sortOrder" | "archived">>) =>
    req<KanbanCardRow>("PATCH", `/api/kanban/cards/${id}`, patch),
  deleteCard: (id: string) => req<{ ok: boolean }>("DELETE", `/api/kanban/cards/${id}`),
  listMailAccounts: () => req<MailAccountRow[]>("GET", "/api/mail/accounts"),
  createMailAccount: (input: {
    name: string;
    host: string;
    port?: number;
    security?: string;
    username: string;
    credentialId?: string | null;
    folder?: string;
  }) => req<MailAccountRow>("POST", "/api/mail/accounts", input),
  patchMailAccount: (
    id: string,
    patch: {
      name?: string;
      host?: string;
      port?: number;
      security?: string;
      username?: string;
      folder?: string;
      password?: string;
    },
  ) => req<unknown>("PATCH", `/api/mail/accounts/${id}`, patch),
  deleteMailAccount: (id: string) => req<{ ok: boolean }>("DELETE", `/api/mail/accounts/${id}`),
  gmailAuthorize: (redirectUri: string) =>
    req<{ url: string }>("POST", "/api/mail/gmail/authorize", { redirectUri }),
  mailMessages: (opts: { account?: string; limit?: number; force?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.account) q.set("account", opts.account);
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.force) q.set("force", "1");
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return req<MailAgg>("GET", `/api/mail/messages${suffix}`);
  },
  mailMessage: (accountId: string, uid: number) =>
    req<MailFull>("GET", `/api/mail/messages/${accountId}/${uid}`),
};
