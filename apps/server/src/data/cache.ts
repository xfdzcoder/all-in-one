/**
 * 数据通道缓存 + 限流（NFR4：防打爆第三方 API）。
 * - TTL 缓存：同 key 在 ttl 内直接回缓存
 * - 最小刷新间隔：**自动轮询**受 minIntervalSec 约束（按 key 计）
 *
 * Q87（项 4）契约变更：**用户显式刷新（force）同时绕过 TTL 读与 minIntervalSec**。
 * 原先「即使强刷也受 minIntervalSec 约束」会让用户连点两次刷新时第二次静默返回旧数据，
 * 表现为「刷新按钮没反应」。限流的目的是防**轮询**打爆上游，而不是拦用户的明确意图；
 * 而自动轮询从不带 force，因此仍然受控。
 */

interface CacheEntry {
  data: unknown;
  fetchedAt: string;
  expiresAt: number;
}

export interface DataCacheOptions {
  defaultTtlSec?: number;
  minIntervalSec?: number;
  maxEntries?: number;
}

export class DataCache {
  private entries = new Map<string, CacheEntry>();
  private lastFetch = new Map<string, number>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly minIntervalMs: number;
  private readonly maxEntries: number;

  constructor(opts: DataCacheOptions = {}) {
    this.defaultTtlMs = (opts.defaultTtlSec ?? 60) * 1000;
    this.minIntervalMs = (opts.minIntervalSec ?? 5) * 1000;
    this.maxEntries = opts.maxEntries ?? 200;
  }

  /** 返回缓存值；过期或无缓存返回 null。 */
  get(key: string): CacheEntry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return e;
  }

  /** SRV-06：**single-flight** —— 同 key 并发取数合并成一次上游调用。
   *  此前两个并发请求都会穿过后台限流（`lastFetch` 只在 `set()` 时写入）→ 重复打上游
   *  （放大抓取、也放大缩略图流量）。返回值是共享的那一次调用。 */
  async coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** true = 允许现在取数；false = 距上次取数太近（限流）。 */
  allowFetch(key: string): boolean {
    const last = this.lastFetch.get(key);
    return last === undefined || Date.now() - last >= this.minIntervalMs;
  }

  set(key: string, data: unknown, ttlSec?: number): CacheEntry {
    // 简单 LRU：超上限时删最旧
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const entry: CacheEntry = {
      data,
      fetchedAt: new Date().toISOString(),
      expiresAt: Date.now() + (ttlSec !== undefined ? ttlSec * 1000 : this.defaultTtlMs),
    };
    this.entries.set(key, entry);
    this.lastFetch.set(key, Date.now());
    return entry;
  }

  /** 失效（SSE 广播前清缓存用）。 */
  invalidate(key: string): void {
    this.entries.delete(key);
    this.lastFetch.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.lastFetch.clear();
  }
}
