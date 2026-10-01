import { useEffect, useMemo, useState } from "react";
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { WidgetDataState } from "@all-in-one/widget-sdk";
import { api, type TodoItem } from "./api";

/** TanStack Query 单例（04-tech-stack：TanStack Query + SSE）。 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/** FR-I3 定时刷新间隔：组件配置 refreshSec（秒）> 0 时优先，否则用组件默认值。 */
function refreshInterval(refreshSec: unknown, defaultMs: number): number {
  const n = Number(refreshSec);
  return n > 0 ? n * 1000 : defaultMs;
}

/** FR-I6 轮询兜底间隔 / SSE 恢复重试间隔。 */
const POLL_INTERVAL_MS = 30_000;
const SSE_RETRY_MS = 60_000;

/**
 * 手动刷新（FR-I3 / **Q87 项 4**）：**必须穿透缓存**。
 *
 * `query.refetch()` 复用同一个 queryFn、无法临时带上 `force`，而服务端 `DataCache`
 * TTL 60s 会直接回旧数据 —— 表现为「点刷新按钮没反应」。因此手动刷新直接以 `force`
 * 回源并写回缓存（与 custom-api / monitor 等既有范式一致）。
 *
 * 只对走 `/api/widgets/data` 的查询必要：REST 端点（todos / kanban / mail / plugins）
 * 没有服务端 TTL 缓存，`refetch()` 本身就是回源。
 */
function forceRefetch(
  qc: ReturnType<typeof useQueryClient>,
  key: readonly unknown[],
  type: string,
  config: Record<string, unknown>,
): () => void {
  return () => {
    void (api.widgetData(type, config, true) as Promise<unknown>)
      .then((d) => qc.setQueryData(key, d))
      .catch(() => {
        /* 回源失败保留旧数据；错误态由下一次常规查询反映 */
      });
  };
}

/** 兜底轮询：失效全部数据查询（与 SSE 通知同效，仅在 SSE 不可用时启用）。 */
function invalidateAllData(qc: ReturnType<typeof useQueryClient>): void {
  for (const key of [
    ["todos"],
    ["feeds"],
    ["kanban"],
    ["kanban-boards"],
    ["mail-messages"],
    ["mail-accounts"],
    ["opencode"],
    ["custom-api"],
    ["launcher"],
    ["plugin-data"],
    // Q87（项 4）：补齐服务类组件 —— 此前这些 key 缺失，SSE 失效/轮询兜底都通知不到它们
    ["immich-gallery"],
    ["navidrome-library"],
    ["portainer-containers"],
    ["portainer-logs"],
    ["mihomo-nodes"],
    ["service-overview"],
    ["monitor"],
    ["media-options"],
  ]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

/** SSE 失效订阅（FR-I6）：按 topic 失效对应查询（todo / rss / kanban）；
 *  SSE 不可用/放弃重连时**轮询兜底**，并定期重试 SSE 恢复低延迟路径。 */
export function useSseInvalidation(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const startPolling = () => {
      if (pollTimer || disposed) return;
      pollTimer = setInterval(() => invalidateAllData(qc), POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const connect = () => {
      if (disposed) return;
      es?.close();
      const src = new EventSource("/api/events");
      es = src;
      src.onopen = () => stopPolling();
      src.addEventListener("invalidation", (e: MessageEvent<string>) => {
        let topic = "todo";
        try {
          topic = String((JSON.parse(e.data) as { topic?: string }).topic ?? "todo");
        } catch {
          /* 保持默认 */
        }
        if (topic === "rss") void qc.invalidateQueries({ queryKey: ["feeds"] });
        else if (topic === "kanban") {
          void qc.invalidateQueries({ queryKey: ["kanban"] });
          void qc.invalidateQueries({ queryKey: ["kanban-boards"] });
        } else void qc.invalidateQueries({ queryKey: ["todos"] });
      });
      src.onerror = () => {
        // CONNECTING = 浏览器自动重连中（无需兜底）；CLOSED = 放弃 → 轮询兜底 + 定期重试
        if (src.readyState === EventSource.CLOSED) {
          startPolling();
          if (!retryTimer && !disposed) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              connect();
            }, SSE_RETRY_MS);
          }
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [qc]);
}

/** Todo 数据（走 REST，变更经 SSE 让其它页面的组件同步 —— J4）。 */
export function useTodos(
  list?: string,
  refreshSec?: unknown,
  includeArchivedOrTagIds?: boolean | string[],
): WidgetDataState<TodoItem[]> & {
  refresh: () => void;
} {
  const qc = useQueryClient();
  // Q29b：第三参兼容旧 tagIds（string[]）与新 includeArchived（boolean）
  const tagIds = Array.isArray(includeArchivedOrTagIds) ? includeArchivedOrTagIds : undefined;
  const includeArchived = includeArchivedOrTagIds === true;
  const tagKey = (tagIds ?? []).join(",") || "all";
  const query = useQuery({
    queryKey: ["todos", list ?? "all", tagKey, includeArchived ? "arch" : "live"],
    queryFn: () => api.listTodos(list, tagIds, includeArchived),
    refetchInterval: refreshInterval(refreshSec, 60_000),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    fetchedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : undefined,
    refresh: () => void qc.invalidateQueries({ queryKey: ["todos"] }),
  };
}

export function useTodoMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["todos"] });
  const create = useMutation({
    // #6 修复：携带清单（组件配置的 list）—— 否则永远进收件箱，配置清单的组件看不到新任务
    mutationFn: (v: { title: string; list?: string }) => api.createTodo(v.title, v.list),
    onSuccess: invalidate,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => api.patchTodo(v.id, { done: v.done }),
    onSuccess: invalidate,
  });
  // Q29b：归档/恢复（归档项不在组件显示）
  const toggleArchive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => api.patchTodo(v.id, { archived: v.archived }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTodo(id),
    onSuccess: invalidate,
  });
  // D43：删除分组 = 真删该组全部任务（调用方二次确认）
  const deleteGroup = useMutation({
    mutationFn: (name: string) => api.deleteTodoGroup(name),
    onSuccess: invalidate,
  });
  return { create, toggle, toggleArchive, remove, deleteGroup };
}

/** 组件卸载安全的本地输入状态。 */
export function useDraft(initial = ""): [string, (v: string) => void] {
  const [v, setV] = useState(initial);
  return [v, setV];
}

/** 自定义 API 组件数据（走服务端数据通道 POST /api/widgets/data —— FR-W3）。 */
export function useCustomApiData(config: Record<string, unknown>): WidgetDataState<unknown> & {
  refresh: () => void;
} {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["custom-api", JSON.stringify(config)],
    queryFn: () => api.widgetData("custom-api", config),
    enabled: Boolean(config.url),
    staleTime: 60_000,
    refetchInterval: refreshInterval(config.refreshSec, 300_000),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    fetchedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : undefined,
    refresh: () => {
      // 手动刷新 = 强制回源（跳过客户端 staleTime 与服务端 TTL 缓存）
      void (api.widgetData("custom-api", config, true) as Promise<unknown>).then((d) =>
        qc.setQueryData(["custom-api", JSON.stringify(config)], d),
      );
    },
  };
}

/** 应用入口探活数据（app-launcher connector —— 内网服务探活，D22）。 */
export function useAppLauncher(items: Array<{ name: string; url: string }>, refreshSec?: unknown) {
  const qc = useQueryClient();
  const key = ["launcher", JSON.stringify(items)];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api.widgetData("app-launcher", { items }) as Promise<{
        items: Array<{ name: string; url: string; alive: boolean }>;
        up: number;
        total: number;
      }>,
    enabled: items.length > 0,
    staleTime: 30_000,
    refetchInterval: refreshInterval(refreshSec, 120_000),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    // 手动刷新 = 强制回源（跳过服务端 TTL 缓存）
    refresh: () => {
      void (api.widgetData("app-launcher", { items }, true) as Promise<unknown>).then((d) =>
        qc.setQueryData(key, d),
      );
    },
  };
}

export type EmbedCheck = { embeddable: boolean; reason: string; verified: boolean };

/** 已安装插件列表（FR-W6；宿主据 status=enabled 动态注册组件 —— J8 新增组件不改核心）。 */
export function usePlugins() {
  const query = useQuery({
    queryKey: ["plugins"],
    queryFn: () => api.listPlugins(),
    staleTime: 60_000,
  });
  return {
    plugins: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: () => void query.refetch(),
  };
}

/** Kanban 看板树（Q6b：列/卡渲染 + SSE 同步）。 */
export function useKanbanTree(boardId: string | undefined, refreshSec?: unknown) {
  const query = useQuery({
    queryKey: ["kanban", boardId ?? ""],
    queryFn: () => api.getBoardTree(boardId!),
    enabled: Boolean(boardId),
    refetchInterval: refreshInterval(refreshSec, 60_000),
  });
  return {
    tree: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: () => void query.refetch(),
  };
}

/** 看板清单（组件内选择器用）。 */
export function useKanbanBoards() {
  const query = useQuery({
    queryKey: ["kanban-boards"],
    queryFn: () => api.listBoards(),
  });
  return {
    boards: query.data ?? [],
    refresh: () => void query.refetch(),
  };
}

/** Kanban 写操作后统一失效（SSE 另有跨组件同步）。 */
export function useKanbanMutations(boardId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["kanban"] });
    void qc.invalidateQueries({ queryKey: ["kanban-boards"] });
  };
  return {
    createBoard: (title: string) => api.createBoard(title).then((r) => (invalidate(), r)),
    renameBoard: (id: string, title: string) => api.renameBoard(id, title).then((r) => (invalidate(), r)),
    deleteBoard: (id: string) => api.deleteBoard(id).then((r) => (invalidate(), r)),
    createColumn: (title: string) =>
      api.createColumn(boardId!, title).then((r) => (invalidate(), r)),
    renameColumn: (id: string, title: string) => api.renameColumn(id, title).then((r) => (invalidate(), r)),
    deleteColumn: (id: string) => api.deleteColumn(id).then((r) => (invalidate(), r)),
    createCard: (columnId: string, title: string) =>
      api.createCard(columnId, title).then((r) => (invalidate(), r)),
    patchCard: (
      id: string,
      patch: Parameters<typeof api.patchCard>[1],
    ) => api.patchCard(id, patch).then((r) => (invalidate(), r)),
    deleteCard: (id: string) => api.deleteCard(id).then((r) => (invalidate(), r)),
  };
}

/** OpenCode 会话数据（FR-E4：会话列表/状态/耗时 + API 版本探测，D32）。 */
export type OpencodeSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
};
export type OpencodeData = {
  probe: { ok: boolean; version?: string; error?: string };
  sessions: OpencodeSession[];
};

export function useOpencodeData(config: Record<string, unknown>) {
  const qc = useQueryClient();
  const key = ["opencode", JSON.stringify(config)];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.widgetData("opencode", config) as Promise<OpencodeData>,
    enabled: Boolean(config.url),
    staleTime: 30_000,
    refetchInterval: refreshInterval(config.refreshSec, 60_000),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    // 手动刷新 = 强制回源（跳过客户端 staleTime 与服务端 TTL 缓存）
    refresh: () => {
      void (api.widgetData("opencode", config, true) as Promise<OpencodeData>).then((d) =>
        qc.setQueryData(key, d),
      );
    },
  };
}

/** 监控源数据（FR：服务器监控，D36 打通第三方服务只做连接与展示）。 */
export type MonitorMetrics = {
  probe: { ok: boolean; source: string; version?: string; error?: string };
  cpuName?: string;
  cores?: number;
  cpu?: { percent: number };
  mem?: { percent: number; usedBytes?: number; totalBytes?: number };
  load?: { min1?: number; min5?: number; min15?: number };
  uptime?: string;
  disks: Array<{ point: string; percent: number; usedBytes?: number; totalBytes?: number }>;
};

export function useMonitorData(config: Record<string, unknown>) {
  const qc = useQueryClient();
  const key = ["monitor", JSON.stringify(config)];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.widgetData("monitor", config) as Promise<MonitorMetrics>,
    enabled: Boolean(config.url),
    staleTime: 30_000,
    refetchInterval: refreshInterval(config.refreshSec, 60_000),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    // 手动刷新 = 强制回源（跳过服务端 TTL 缓存）
    refresh: () => {
      void (api.widgetData("monitor", config, true) as Promise<MonitorMetrics>).then((d) =>
        qc.setQueryData(key, d),
      );
    },
  };
}

/** 邮件账号清单（Q7b）。 */
export function useMailAccounts() {
  const query = useQuery({
    queryKey: ["mail-accounts"],
    queryFn: () => api.listMailAccounts(),
  });
  return {
    accounts: query.data ?? [],
    refresh: () => void query.refetch(),
  };
}

/** Immich 照片墙（FR-X3 只读深度，D50）：缩略图服务端代取为 data URI。
 *  `albumId`（Q87 项 4）= 「只看相册」——**必须进 queryKey 与请求体**，此前前端把它丢了，
 *  导致改配置不生效、点刷新也只是一遍遍重发同一请求。 */
export function useImmichGallery(
  sourceId?: string,
  limit?: unknown,
  refreshSec?: unknown,
  albumId?: unknown,
) {
  const n = typeof limit === "number" && Number.isFinite(limit) ? limit : 12;
  const album = typeof albumId === "string" && albumId ? albumId : undefined;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["immich-gallery", sourceId ?? "", n, album ?? ""],
    queryFn: () => api.widgetData("immich-gallery", { sourceId, limit: n, albumId: album }) as Promise<Record<string, unknown>>,
    enabled: Boolean(sourceId),
    staleTime: 60_000,
    refetchInterval: refreshInterval(refreshSec, 300_000),
  });
  return {
    data: query.data as
      | {
          items: Array<{
            id: string;
            at: string;
            type: "IMAGE" | "VIDEO";
            thumb: string;
            href: string;
            /** D60 §1：服务端从缩略图字节头解析的原始宽高（Q89 等比装箱用）。 */
            width?: number;
            height?: number;
          }>;
          notes?: string[];
        }
      | undefined,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: forceRefetch(qc, ["immich-gallery", sourceId ?? "", n, album ?? ""], "immich-gallery", {
      sourceId,
      limit: n,
      albumId: album,
    }),
  };
}

/** Navidrome 专辑墙（FR-X3 只读深度，D50）：最近添加，封面服务端代取。
 *  Q94（反馈②）：「正在播放」已按用户要求移除。
 *  `artistId`（Q87 项 4）= 「只看艺人」——同上，必须进 queryKey 与请求体。 */
export function useNavidromeLibrary(
  sourceId?: string,
  limit?: unknown,
  refreshSec?: unknown,
  artistId?: unknown,
) {
  const n = typeof limit === "number" && Number.isFinite(limit) ? limit : 12;
  const artist = typeof artistId === "string" && artistId ? artistId : undefined;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["navidrome-library", sourceId ?? "", n, artist ?? ""],
    queryFn: () => api.widgetData("navidrome-library", { sourceId, limit: n, artistId: artist }) as Promise<Record<string, unknown>>,
    enabled: Boolean(sourceId),
    staleTime: 60_000,
    refetchInterval: refreshInterval(refreshSec, 300_000),
  });
  return {
    data: query.data as
      | {
          albums: Array<{
            id: string;
            name: string;
            artist?: string;
            cover: string;
            /** D60 §1：服务端从封面字节头解析的原始宽高（Q89 等比装箱用）。 */
            width?: number;
            height?: number;
          }>;
          notes?: string[];
        }
      | undefined,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: forceRefetch(qc, ["navidrome-library", sourceId ?? "", n, artist ?? ""], "navidrome-library", {
      sourceId,
      limit: n,
      artistId: artist,
    }),
  };
}

/** Portainer 容器清单（FR-X3 只读深度，D50）。 */
export function usePortainerContainers(sourceId?: string, refreshSec?: unknown) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["portainer-containers", sourceId ?? ""],
    queryFn: () => api.widgetData("portainer-containers", { sourceId }) as Promise<Record<string, unknown>>,
    enabled: Boolean(sourceId),
    staleTime: 30_000,
    refetchInterval: refreshInterval(refreshSec, 120_000),
  });
  return {
    data: query.data as
      | {
          containers: Array<{
            id: string;
            name: string;
            state: string;
            status: string;
            image?: string;
            ports?: string;
            abnormal: boolean;
          }>;
          notes?: string[];
        }
      | undefined,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: forceRefetch(qc, ["portainer-containers", sourceId ?? ""], "portainer-containers", { sourceId }),
  };
}

/** 容器日志尾部（点行时按需取，只读）。 */
export function usePortainerLogs(sourceId?: string, containerId?: string) {
  const query = useQuery({
    queryKey: ["portainer-logs", sourceId ?? "", containerId ?? ""],
    queryFn: () => api.widgetData("portainer-logs", { sourceId, containerId }) as Promise<{ logs: string }>,
    enabled: Boolean(sourceId && containerId),
    staleTime: 10_000,
  });
  return {
    logs: query.data?.logs,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
  };
}

/** Mihomo 节点面板（FR-X3 只读深度，D50）。 */
export function useMihomoNodes(sourceId?: string, refreshSec?: unknown) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["mihomo-nodes", sourceId ?? ""],
    queryFn: () => api.widgetData("mihomo-nodes", { sourceId }) as Promise<Record<string, unknown>>,
    enabled: Boolean(sourceId),
    staleTime: 30_000,
    refetchInterval: refreshInterval(refreshSec, 120_000),
  });
  return {
    data: query.data as
      | {
          groups: Array<{ name: string; now?: string; members: number; options: string[] }>;
          nodes: Array<{ name: string; type?: string; alive?: boolean; delayMs?: number }>;
          providers: Array<{ name: string; nodes: number; updatedAt?: string }>;
          notes?: string[];
        }
      | undefined,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: forceRefetch(qc, ["mihomo-nodes", sourceId ?? ""], "mihomo-nodes", { sourceId }),
  };
}

/** Portainer 容器重启（FR-X3f 写操作，D51：仅 restart + 白名单 + 确认）。 */
export function usePortainerRestart(sourceId?: string) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (containerId: string) => api.portainerRestart(sourceId ?? "", containerId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["portainer-containers"] }),
  });
  return {
    send: (containerId: string) => {
      if (sourceId) mutation.mutate(containerId);
    },
    busy: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : undefined,
  };
}

/** 服务概览（Q39/D46）：sourceId → 服务端按连接 kind 派发适配器。 */
export function useServiceOverview(sourceId?: string, refreshSec?: unknown) {
  const key = ["service-overview", sourceId ?? ""];
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.widgetData("service-overview", { sourceId }) as Promise<Record<string, unknown>>,
    enabled: Boolean(sourceId),
    staleTime: 30_000,
    refetchInterval: refreshInterval(refreshSec, 60_000),
  });
  return {
    data: query.data as
      | { probe: { ok: boolean; version?: string; error?: string }; stats: Array<{ label: string; value: string }> }
      | undefined,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: forceRefetch(qc, key, "service-overview", { sourceId }),
  };
}

/** 聚合邮件列表（只读；服务端 60s 缓存，手动刷新可 force 穿透）。 */
export function useMailMessages(account: string | undefined, limit = 20, refreshSec?: unknown) {
  const qc = useQueryClient();
  const key = ["mail-messages", account ?? "all", limit];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.mailMessages({ account, limit }),
    staleTime: 30_000,
    refetchInterval: refreshInterval(refreshSec, 300_000),
  });
  return {
    agg: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    // 手动刷新 = 强制回源（force 穿透服务端列表缓存）
    refresh: () => {
      void api.mailMessages({ account, limit, force: true }).then((d) => qc.setQueryData(key, d));
    },
  };
}

/** 单封正文（沙箱渲染前取回，D30）。 */
export function useMailMessage(accountId: string | null, uid: number | null) {
  const query = useQuery({
    queryKey: ["mail-message", accountId, uid],
    queryFn: () => api.mailMessage(accountId!, uid!),
    enabled: Boolean(accountId) && uid !== null,
    staleTime: 300_000,
  });
  return {
    message: query.data,
    error: query.error instanceof Error ? query.error.message : undefined,
  };
}

/** 邮件账号管理（密码先入凭证库 SEC3，账号只保存引用）。 */
export function useMailMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["mail-accounts"] });
    void qc.invalidateQueries({ queryKey: ["mail-messages"] });
    void qc.invalidateQueries({ queryKey: ["mail-message"] });
  };
  return {
    createAccount: async (input: {
      name: string;
      host: string;
      port?: number;
      security?: string;
      username: string;
      folder?: string;
      password?: string;
    }) => {
      // 口令只进凭证库（SEC3）：不随账号创建请求传输
      const { password, ...rest } = input;
      let credentialId: string | null = null;
      if (password) {
        const cred = await api.createCredential(`mail-${Date.now()}`, password, "generic");
        credentialId = cred.id;
      }
      const row = await api.createMailAccount({ ...rest, credentialId });
      invalidate();
      return row;
    },
    deleteAccount: (id: string) => api.deleteMailAccount(id).then((r) => (invalidate(), r)),
  };
}

/** 插件数据桥（FR-W3：宿主统一取数 → 沙箱；权限在服务端按白名单把关，D26）。 */
export function usePluginData(
  type: string,
  source: string | undefined,
  config: Record<string, unknown>,
) {
  const enabled = Boolean(source) && source !== "none";
  const query = useQuery({
    queryKey: ["plugin-data", type, JSON.stringify(config)],
    queryFn: () => api.widgetData(type, config),
    enabled,
    staleTime: 60_000,
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
  };
}

/** iframe 禁嵌检测（iframe-embed connector 读响应头判定 —— 浏览器禁嵌时 iframe 的
 *  load 事件照常触发，前端无法自判，见 connector/iframe.ts）。 */
export function useEmbedCheck(url: string): EmbedCheck | null | undefined {
  const query = useQuery({
    queryKey: ["iframe-embed", url],
    queryFn: () =>
      api.widgetData("iframe-embed", { url, parentOrigin: window.location.origin }) as Promise<EmbedCheck>,
    enabled: Boolean(url),
    staleTime: 300_000,
  });
  return query.data;
}

/** RSS 聚合数据（走数据通道 + 已读态 Workspace 同步）。 */
export function useFeeds(
  limit: number,
  refreshSec?: unknown,
  filter?: "all" | "unread",
  tagIds?: string[],
) {
  const qc = useQueryClient();
  // Q93（项 1）：**入参防呆**。`tagIds` 来自组件配置，可能是空串/非数组（存过畸形值）——
  // 原来直接 `(tagIds ?? []).join()`，一旦是 `""` 就是 `"".join is not a function`，而且是在
  // **render 期**抛错 → 整棵 React 树卸载（白屏）、每次渲染都抛 → 永远无法恢复。
  const tags: string[] = Array.isArray(tagIds) ? tagIds.filter((x): x is string => typeof x === "string") : [];
  const key = ["feeds", limit, filter ?? "all", tags.join(",") || "all"];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.widgetData("rss", { limit, filter, tagIds: tags }) as Promise<import("./api").FeedAgg>,
    staleTime: 60_000,
    refetchInterval: refreshInterval(refreshSec, 300_000),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    // 手动刷新 = 强制回源（跳过服务端 TTL 缓存）
    refresh: () => {
      void (api.widgetData("rss", { limit, filter, tagIds }, true) as Promise<unknown>).then((d) =>
        qc.setQueryData(key, d),
      );
    },
  };
}

export function useFeedSources() {
  return useQuery({ queryKey: ["feed-sources"], queryFn: () => api.listFeeds() });
}

/** RSS 变更（标已读/订阅/退订）→ 失效 feeds + sources（SSE 兜底其它组件）。 */
export function useFeedMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["feeds"] });
    void qc.invalidateQueries({ queryKey: ["feed-sources"] });
    void qc.invalidateQueries({ queryKey: ["custom-api"] });
  };
  return {
    markRead: useMutation({ mutationFn: (itemKey: string) => api.markFeedRead(itemKey), onSuccess: invalidate }),
    addSource: useMutation({
      mutationFn: (v: { title: string; url: string }) => api.createFeed(v.title, v.url),
      onSuccess: invalidate,
    }),
    removeSource: useMutation({ mutationFn: (id: string) => api.deleteFeed(id), onSuccess: invalidate }),
  };
}

/** Workspace 标签（FR-D1/D2，D40）：列表 + 变更（改后失效 todos/feeds/queries）。 */
export function useTags() {
  const query = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
  };
}

export function useTagMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["tags"] });
    void qc.invalidateQueries({ queryKey: ["todos"] });
    void qc.invalidateQueries({ queryKey: ["feeds"] });
    // Q27b#5：订阅源列表键是 feed-sources（漏失效 → 打标"存了但选不上"）
    void qc.invalidateQueries({ queryKey: ["feed-sources"] });
  };
  const create = useMutation({
    mutationFn: (v: { name: string; color?: string }) => api.createTag(v.name, v.color),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: string | null }) =>
      api.updateTag(v.id, { name: v.name, color: v.color }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: invalidate,
  });
  const setTarget = useMutation({
    mutationFn: (v: { targetType: "todo" | "feed"; targetId: string; tagIds: string[] }) =>
      api.setTargetTags(v.targetType, v.targetId, v.tagIds),
    onSuccess: invalidate,
  });
  return { create, update, remove, setTarget };
}

/** 命名数据连接（D42）：列表 + 变更。 */
export function useDataSources(kind?: string) {
  const query = useQuery({
    queryKey: ["data-sources", kind ?? "all"],
    queryFn: () => api.listDataSources(kind),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
  };
}

export function useDataSourceMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["data-sources"] });
  const create = useMutation({
    mutationFn: (v: { kind: string; name: string; config: Record<string, unknown> }) =>
      api.createDataSource(v),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; name?: string; config?: Record<string, unknown> }) =>
      api.updateDataSource(v.id, { name: v.name, config: v.config }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDataSource(id),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

/** 动态选项源（Q26b / D42）：ConfigForm 的 select.dynamic 取数（一次取全，按 key 查表）。 */
/**
 * 动态选项源（Q26b/D42）。`scopeSourceId`（Q72/**D57**）= 当前表单选中的「数据连接」：
 * 相册/艺人清单随连接变化，故按 `依赖key:sourceId` 形式额外产出两个**带作用域**的选项源。
 */
export function useDynamicOptionsMap(
  scopeSourceId?: string,
  scopeDynamic?: string,
): Record<string, Array<{ value: string; label: string }>> {
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });
  const todosAll = useQuery({
    queryKey: ["todos", "all", "__names__"],
    queryFn: () => api.listTodos(undefined, undefined, true),
  });
  const boards = useKanbanBoards();
  // Q33：mail-accounts 选项源（此前缺失 —— 邮箱多选下拉恒空）
  const mailAccounts = useMailAccounts();
  const monitor = useDataSources("monitor");
  const opencode = useDataSources("opencode");
  const http = useDataSources("http");
  // Q39/D46：服务概览可选连接（immich/navidrome/portainer/mihomo）
  const svcImmich = useDataSources("immich");
  const svcNavidrome = useDataSources("navidrome");
  const svcPortainer = useDataSources("portainer");
  const svcMihomo = useDataSources("mihomo");
  // Q72/D57：依赖 sourceId 的选项源 —— `scope.dynamic` 指明要哪类清单，
  // 换连接即换 queryKey → 自动重取；未选连接时不发请求。
  const sid = typeof scopeSourceId === "string" ? scopeSourceId : "";
  const scoped = useQuery({
    queryKey: ["media-options", scopeDynamic ?? "", sid],
    queryFn: () =>
      api.widgetData(scopeDynamic ?? "", { sourceId: sid }).then((d) => {
        const items = (d as { items?: Array<{ value: string; label: string }> }).items;
        return Array.isArray(items) ? items : [];
      }),
    enabled: Boolean(scopeDynamic && sid),
  });
  return {
    // Q72/D57：带作用域的选项源 —— ConfigForm 按 `${dynamic}:${depValue}` 取
    [`${scopeDynamic ?? ""}:${sid}`]: scoped.data ?? [],
    "kanban-boards": boards.boards.map((b) => ({ value: b.id, label: b.title })),
    "todo-names": [...new Set((todosAll.data ?? []).map((t: { list: string }) => t.list))].map((n: string) => ({
      value: n,
      label: n,
    })),
    "data-source:monitor": (monitor.data ?? []).map((r) => ({ value: r.id, label: r.name })),
    "data-source:opencode": (opencode.data ?? []).map((r) => ({ value: r.id, label: r.name })),
    "data-source:http": (http.data ?? []).map((r) => ({ value: r.id, label: r.name })),
    "data-source:service": [...(svcImmich.data ?? []), ...(svcNavidrome.data ?? []), ...(svcPortainer.data ?? []), ...(svcMihomo.data ?? [])].map(
      (r: { id: string; name: string }) => ({ value: r.id, label: r.name }),
    ),
    // Q50：按 kind 细分的选项源（FR-X3 深度组件各自只选本类连接）
    "data-source:immich": (svcImmich.data ?? []).map((r: { id: string; name: string }) => ({ value: r.id, label: r.name })),
    "data-source:navidrome": (svcNavidrome.data ?? []).map((r: { id: string; name: string }) => ({ value: r.id, label: r.name })),
    "data-source:portainer": (svcPortainer.data ?? []).map((r: { id: string; name: string }) => ({ value: r.id, label: r.name })),
    "data-source:mihomo": (svcMihomo.data ?? []).map((r: { id: string; name: string }) => ({ value: r.id, label: r.name })),
    tags: (tags.data ?? []).map((t: { id: string; name: string }) => ({ value: t.id, label: t.name })),
    "mail-accounts": mailAccounts.accounts.map((a: { id: string; name: string }) => ({ value: a.id, label: a.name })),
  };
}

/**
 * 连接解析（D42）：config.sourceId 命中命名连接时合并其配置（内联值可覆盖）；
 * pick 限定合并键（自定义 API 只取认证）。未引用/未命中 → 原样返回（内联回落）。
 */
export function useResolvedSourceConfig<T extends Record<string, unknown>>(
  kind: string,
  config: T,
  pick?: string[],
): T {
  const sources = useDataSources(kind);
  const sourceId = typeof config.sourceId === "string" ? config.sourceId : "";
  const source = (sources.data ?? []).find((r) => r.id === sourceId);
  return useMemo(() => {
    if (!source) return config;
    const srcConfig = source.config ?? {};
    const from = pick
      ? Object.fromEntries(Object.entries(srcConfig).filter(([k]) => pick.includes(k)))
      : srcConfig;
    return { ...config, ...from } as T;
  }, [config, source, pick]);
}

/**
 * 卡片标题跳转地址（Q86 / **D59**）= 绑定数据源的 `config.url`。
 * 未绑定连接 / 连接无 url / url 不是 http(s) → `undefined`（标题不渲染成链接）。
 */
export function useSourceHomeUrl(sourceId: unknown): string | undefined {
  const all = useDataSources();
  const sid = typeof sourceId === "string" ? sourceId : "";
  const row = (all.data ?? []).find((r) => r.id === sid);
  const url = (row?.config as Record<string, unknown> | undefined)?.url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined;
}

/** 页面列表（Q29b：任务页签标注所在 Dashboard）。 */
export function useDashboards() {
  const query = useQuery({ queryKey: ["dashboards"], queryFn: () => api.listDashboards() });
  return { data: query.data };
}
