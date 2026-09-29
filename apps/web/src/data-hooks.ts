import { useEffect, useState } from "react";
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

/** SSE 失效订阅（FR-I6）：任意端发布 invalidation → 重取 todo。 */
export function useSseInvalidation(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("invalidation", () => {
      void qc.invalidateQueries({ queryKey: ["todos"] });
    });
    return () => es.close();
  }, [qc]);
}

/** Todo 数据（走 REST，变更经 SSE 让其它页面的组件同步 —— J4）。 */
export function useTodos(list?: string): WidgetDataState<TodoItem[]> {
  const query = useQuery({
    queryKey: ["todos", list ?? "all"],
    queryFn: () => api.listTodos(list),
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    fetchedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : undefined,
  };
}

export function useTodoMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["todos"] });
  const create = useMutation({
    mutationFn: (title: string) => api.createTodo(title),
    onSuccess: invalidate,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => api.patchTodo(v.id, { done: v.done }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTodo(id),
    onSuccess: invalidate,
  });
  return { create, toggle, remove };
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
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
    fetchedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : undefined,
    refresh: () => void qc.invalidateQueries({ queryKey: ["custom-api"] }),
  };
}

/** 应用入口探活数据（app-launcher connector —— 内网服务探活，D22）。 */
export function useAppLauncher(items: Array<{ name: string; url: string }>) {
  const query = useQuery({
    queryKey: ["launcher", JSON.stringify(items)],
    queryFn: () =>
      api.widgetData("app-launcher", { items }) as Promise<{
        items: Array<{ name: string; url: string; alive: boolean }>;
        up: number;
        total: number;
      }>,
    enabled: items.length > 0,
    staleTime: 30_000,
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
  };
}

export type EmbedCheck = { embeddable: boolean; reason: string; verified: boolean };

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
export function useFeeds(limit: number) {
  const query = useQuery({
    queryKey: ["feeds", limit],
    queryFn: () => api.widgetData("rss", { limit }) as Promise<import("./api").FeedAgg>,
    staleTime: 60_000,
  });
  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : undefined,
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
