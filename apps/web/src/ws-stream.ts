import { useEffect, useRef } from "react";

/**
 * WS 数据源流订阅（**批H4 / Q78，D56**）：服务端 WS → `/api/events` SSE（`ws:<id>` topic
 * 带 payload）→ 本模块按 sourceId 分发给订阅者。**不新增前端连接**（D56：复用现有 SSE 通道）。
 *
 * 分发器是纯 Map 注册表（可单测）；`useWsStream` 只做订阅生命周期。
 */

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

/** 订阅某 WS 源的流（返回退订函数）。 */
export function subscribeWs(sourceId: string, fn: Listener): () => void {
  let set = listeners.get(sourceId);
  if (!set) {
    set = new Set();
    listeners.set(sourceId, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) listeners.delete(sourceId);
  };
}

/** SSE 收到 `ws:<id>` 事件时由 data-hooks 调用（topic 不含 ws: 前缀）。 */
export function dispatchWs(sourceId: string, payload: unknown): void {
  const set = listeners.get(sourceId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch {
      // 单个订阅者异常不影响其它订阅者
    }
  }
}

/** 组件侧：订阅 WS 流（onMessage 用 ref 保持最新，不因重渲染退订重订）。 */
export function useWsStream(sourceId: string | undefined, onMessage: Listener): void {
  const fnRef = useRef<Listener | null>(null);
  // 渲染期不写 ref（react(refs)）—— effect 内同步；消息回调按 ref 取最新闭包
  useEffect(() => {
    fnRef.current = onMessage;
  }, [onMessage]);
  useEffect(() => {
    if (!sourceId) return;
    return subscribeWs(sourceId, (p) => fnRef.current?.(p));
  }, [sourceId]);
}
