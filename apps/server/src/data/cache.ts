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

/** 粗略字节估算（JSON 序列化长度；缓存值都是可序列化的连接器输出）。 */
function estimateBytes(data: unknown): number {
  try {
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return 0;
  }
}

interface CacheEntry {
  data: unknown;
  fetchedAt: string;
  expiresAt: number;
  /** SRV-05：字节占用（估算值），用于字节封顶与淘汰退还。 */
  size: number;
}

export interface DataCacheOptions {
  defaultTtlSec?: number;
  minIntervalSec?: number;
  maxEntries?: number;
  maxBytes?: number;
}

export class DataCache {
  private entries = new Map<string, CacheEntry>();
  private lastFetch = new Map<string, number>();
  private inflight = new Map<string, Promise<unknown>>();
  private totalBytes = 0;
  private readonly defaultTtlMs: number;
  private readonly minIntervalMs: number;
  private readonly maxEntries: number;
  /** SRV-05：**字节封顶**（条目数封顶挡不住 base64 缩略图 —— 单条数据可达数十 MB）。 */
  private readonly maxBytes: number;

  constructor(opts: DataCacheOptions = {}) {
    this.defaultTtlMs = (opts.defaultTtlSec ?? 60) * 1000;
    this.minIntervalMs = (opts.minIntervalSec ?? 5) * 1000;
    this.maxEntries = opts.maxEntries ?? 200;
    this.maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  }

  /** 返回缓存值；过期或无缓存返回 null。 */
  get(key: string): CacheEntry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.totalBytes -= e.size;
      this.entries.delete(key);
      return null;
    }
    // SRV-19：命中刷新 recency —— Map 迭代序即插入序，delete+set 移到队尾。
    // 原实现「简单 LRU」实为 FIFO：命中不重排，超限时 `delete(oldest)` 会淘汰仍在高频使用的条目。
    this.entries.delete(key);
    this.entries.set(key, e);
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
    const size = estimateBytes(data);
    // 覆盖旧值：先退还旧字节
    const prev = this.entries.get(key);
    if (prev) {
      this.totalBytes -= prev.size;
      // SRV-19：覆盖已存在 key 同样重排到队尾（Map.set 不会移动既有键的迭代位）
      this.entries.delete(key);
    }
    // LRU（SRV-19 修正）：超条目/字节上限时淘汰**最久未命中**（直到装得下；单条超预算则清空后仍缓存，保证命中率）
    while (
      this.entries.size > 0 &&
      (this.entries.size >= this.maxEntries || this.totalBytes + size > this.maxBytes) &&
      !this.entries.has(key)
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this.entries.get(oldest);
      if (evicted) this.totalBytes -= evicted.size;
      this.entries.delete(oldest);
    }
    const entry: CacheEntry = {
      data,
      fetchedAt: new Date().toISOString(),
      expiresAt: Date.now() + (ttlSec !== undefined ? ttlSec * 1000 : this.defaultTtlMs),
      size,
    };
    this.entries.set(key, entry);
    this.totalBytes += size;
    this.lastFetch.set(key, Date.now());
    return entry;
  }

  /** 失效（SSE 广播前清缓存用）。 */
  invalidate(key: string): void {
    const e = this.entries.get(key);
    if (e) this.totalBytes -= e.size;
    this.entries.delete(key);
    this.lastFetch.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.lastFetch.clear();
  }
}
