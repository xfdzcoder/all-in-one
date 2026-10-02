/**
 * SSE 失效通知（FR-I6）：数据变更时推给前端，触发 TanStack Query 重取。
 * 单用户规模用内存事件总线即可；断线由客户端 EventSource 自动重连。
 */

export interface InvalidationEvent {
  /** 资源名（如 "todo"、"http:<cacheKey>"、"ws:<sourceId>"）。 */
  topic: string;
  at: string;
  /** 消息载荷（D56/Q77）：WS 数据源转发携带；失效类事件无载荷。 */
  payload?: unknown;
}

type Listener = (e: InvalidationEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(topic: string, payload?: unknown): void {
    const e: InvalidationEvent = { topic, at: new Date().toISOString(), payload };
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // 单个订阅者异常不影响其它订阅者
      }
    }
  }
}
