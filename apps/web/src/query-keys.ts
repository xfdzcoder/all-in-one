/**
 * React-Query 查询键唯一事实来源（**WEB-11 收口**）。
 *
 * 此前 key 字符串拼接散落 `data-hooks.ts` 各处：`invalidateAllData` 手抄 16 个根键、
 * `forceRefetch`/`setQueryData` 调用点把同一 key **再抄一遍** —— 新增查询忘抄一处即
 * 「SSE/轮询通知不到、刷新写错缓存」（Q87 已踩过一次）。
 *
 * 两级结构：**`qkRoot` = 失效前缀**（invalidateQueries 用），**`qk` = 带参查询键**
 * （useQuery 与 forceRefetch 共用同一个 builder 结果，物理上不可能抄错）。
 * builder 的根段 spread 自 `qkRoot`，两层同源不会漂移。调用点禁止再造 key 字面量。
 */

/** 失效前缀（根键）。`invalidateQueries({ queryKey: qkRoot.todos })` 失效全部 todos 变体。 */
export const qkRoot = {
  todos: ["todos"] as const,
  feeds: ["feeds"] as const,
  kanban: ["kanban"] as const,
  kanbanBoards: ["kanban-boards"] as const,
  mailAccounts: ["mail-accounts"] as const,
  mailMessages: ["mail-messages"] as const,
  mailMessage: ["mail-message"] as const,
  opencode: ["opencode"] as const,
  customApi: ["custom-api"] as const,
  launcher: ["launcher"] as const,
  plugins: ["plugins"] as const,
  pluginData: ["plugin-data"] as const,
  icons: ["icons"] as const,
  monitor: ["monitor"] as const,
  serviceOverview: ["service-overview"] as const,
  mediaOptions: ["media-options"] as const,
  immichGallery: ["immich-gallery"] as const,
  immichPreview: ["immich-preview"] as const,
  navidromeLibrary: ["navidrome-library"] as const,
  portainerContainers: ["portainer-containers"] as const,
  portainerLogs: ["portainer-logs"] as const,
  mihomoNodes: ["mihomo-nodes"] as const,
  iframeEmbed: ["iframe-embed"] as const,
  feedSources: ["feed-sources"] as const,
  tags: ["tags"] as const,
  dataSources: ["data-sources"] as const,
  dashboards: ["dashboards"] as const,
};

/** 带参查询键构造器。参数 = 该查询的实际区分维度（进 key 才会分缓存）。 */
export const qk = {
  todos: qkRoot.todos,
  todoList: (list: string | undefined, tagKey: string, includeArchived: boolean) =>
    [...qkRoot.todos, list ?? "all", tagKey, includeArchived ? "arch" : "live"] as const,
  feeds: qkRoot.feeds,
  kanban: qkRoot.kanban,
  kanbanBoard: (boardId: string | undefined) => [...qkRoot.kanban, boardId ?? ""] as const,
  kanbanBoards: qkRoot.kanbanBoards,
  mailAccounts: qkRoot.mailAccounts,
  mailMessages: (idsKey: string, limit: number) => [...qkRoot.mailMessages, idsKey || "all", limit] as const,
  mailMessage: (accountId: string | null, uid: number | string | null) =>
    [...qkRoot.mailMessage, accountId, uid] as const,
  opencode: (configJson: string) => [...qkRoot.opencode, configJson] as const,
  customApi: (configJson: string) => [...qkRoot.customApi, configJson] as const,
  launcher: (itemsJson: string) => [...qkRoot.launcher, itemsJson] as const,
  plugins: qkRoot.plugins,
  pluginData: (type: string, configJson: string) => [...qkRoot.pluginData, type, configJson] as const,
  icons: qkRoot.icons,
  monitor: (configJson: string) => [...qkRoot.monitor, configJson] as const,
  serviceOverview: (sourceId: string) => [...qkRoot.serviceOverview, sourceId] as const,
  mediaOptions: (scope: string | undefined, sourceId: string) =>
    [...qkRoot.mediaOptions, scope ?? "", sourceId] as const,
  immichGallery: (sourceId: string, limit: number, albumId: string) =>
    [...qkRoot.immichGallery, sourceId, limit, albumId] as const,
  immichPreview: (sourceId: string, assetId: string) =>
    [...qkRoot.immichPreview, sourceId, assetId] as const,
  navidromeLibrary: (sourceId: string, limit: number, artistId: string) =>
    [...qkRoot.navidromeLibrary, sourceId, limit, artistId] as const,
  portainerContainers: (sourceId: string) => [...qkRoot.portainerContainers, sourceId] as const,
  portainerLogs: (sourceId: string, containerId: string) =>
    [...qkRoot.portainerLogs, sourceId, containerId] as const,
  mihomoNodes: (sourceId: string) => [...qkRoot.mihomoNodes, sourceId] as const,
  iframeEmbed: (url: string) => [...qkRoot.iframeEmbed, url] as const,
  feedSources: qkRoot.feedSources,
  tags: qkRoot.tags,
  dataSources: (kind: string | undefined) => [...qkRoot.dataSources, kind ?? "all"] as const,
  dashboards: qkRoot.dashboards,
  /** Todo 名称选项源（Q29b creatable）：includeArchived 全量取名 —— 独立变体键。 */
  todoNames: () => [...qkRoot.todos, "all", "__names__"] as const,
};

/**
 * SSE 失效 / 轮询兜底（`invalidateAllData`）覆盖的根键。
 *
 * **有意不含** `immichGallery` / `navidromeLibrary`（WEB-8，Q99c）：两墙 payload 是整批
 * base64 缩略图，进 30s 兜底轮询 = 纯 churn；它们按各自 `refreshSec`（默认 300s）与手动刷新取数。
 * 也不含 `icons`/`plugins`（管理面 REST 列表，非数据通道，变更走各自 mutation 失效）。
 */
export const DATA_ROOT_KEYS: ReadonlyArray<readonly unknown[]> = [
  qkRoot.todos,
  qkRoot.feeds,
  qkRoot.kanban,
  qkRoot.kanbanBoards,
  qkRoot.mailMessages,
  qkRoot.mailAccounts,
  qkRoot.mailMessage,
  qkRoot.opencode,
  qkRoot.customApi,
  qkRoot.launcher,
  qkRoot.pluginData,
  qkRoot.portainerContainers,
  qkRoot.portainerLogs,
  qkRoot.mihomoNodes,
  qkRoot.serviceOverview,
  qkRoot.monitor,
  qkRoot.mediaOptions,
];

/** SSE topic → 失效根键（FR-I6）。Map 无原型链陷阱（对象字面量查 "toString" 会命中 Function）。 */
const SSE_TOPIC_KEYS = new Map<string, ReadonlyArray<readonly unknown[]>>([
  ["rss", [qkRoot.feeds]],
  ["kanban", [qkRoot.kanban, qkRoot.kanbanBoards]],
]);

/** topic → 应失效的根键；未映射 topic 一律按 todos 处理（与旧 if/else 链语义一致）。 */
export function sseKeysFor(topic: string): ReadonlyArray<readonly unknown[]> {
  return SSE_TOPIC_KEYS.get(topic) ?? [qkRoot.todos];
}
