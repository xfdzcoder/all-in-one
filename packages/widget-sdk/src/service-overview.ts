/**
 * 服务概览契约（D48：结构化卡片 + 迷你图表）。
 *
 * 背景（Q40 质量门禁）：v1 的 `stats: [{label,value}]` 只能放"几个孤零零的数字"，
 * 被用户批评为 demo 级。结构化模型按「用户问题 → 指标」推导（08-widget-quality §3）：
 * 主指标 / 次指标 / 状态徽标 / 清单（异常·最近·正在发生）/ 迷你趋势。
 *
 * 趋势数据来源：服务端只回**本次采样点**（sample），客户端按轮询累积成序列 ——
 * 不改 schema、不动 D18（真机实测 mihomo /traffic 流式经反代不可用，速率用累计量差分）。
 */

/** 主/次指标（数值带单位与语义，如 "95.2 GB"、"23/25 运行中"）。 */
export interface ServiceMetric {
  label: string;
  value: string;
  /** 副说明（占比/分解，如 "照片 58.5 GB · 视频 31.0 GB"）。 */
  hint?: string;
  /** 主指标标记：每卡 ≤1 个，组件以最大字号呈现。 */
  emphasis?: boolean;
}

/** 状态徽标（健康 / 异常 / 进行中 / 提示）。 */
export interface ServiceStatus {
  tone: "ok" | "warn" | "error" | "info";
  text: string;
}

/** 清单项（异常容器、最近添加、正在播放、最近事件等）。 */
export interface ServiceListItem {
  title: string;
  detail?: string;
  tone?: "ok" | "warn" | "error" | "info";
  /** 事件时间（ISO 或毫秒时间戳字符串），组件负责相对化 + 悬浮绝对。 */
  at?: string;
}

/** 分组清单（异常清单置顶、全健康给绿态不留空 —— 08 §3）。 */
export interface ServiceList {
  title: string;
  items: ServiceListItem[];
}

/** 本次采样点（客户端累积为迷你趋势序列）。 */
export interface ServiceSample {
  /** 采样时间（ISO 字符串）。 */
  at: string;
  /** 数值序列（如 `{ upBps, downBps }`、`{ activeConnections }`）。 */
  series: Record<string, number>;
}

/** 归一后的服务概览（所有服务适配器的输出形状）。 */
export interface ServiceOverview {
  probe: {
    ok: boolean;
    /** 连接 kind（immich/navidrome/portainer/mihomo/…）。 */
    source: string;
    version?: string;
    error?: string;
  };
  /** 主指标（≤1，emphasis）+ 次指标（2–4）。 */
  metrics: ServiceMetric[];
  statuses?: ServiceStatus[];
  lists?: ServiceList[];
  sample?: ServiceSample;
  /**
   * 诚实降级说明（"原因 + 怎么修"，08 §5 硬规则）：
   * 取不到的指标必须在此说明，禁止在指标位写"该服务未提供"甩锅文案。
   */
  notes?: string[];
}

/** 契约校验：返回错误清单（空 = 合法）。用于适配器契约测试与插件数据边界。 */
export function validateServiceOverview(v: unknown): string[] {
  const errs: string[] = [];
  if (!v || typeof v !== "object") return ["overview 必须是对象"];
  const o = v as Record<string, unknown>;
  const probe = o.probe as Record<string, unknown> | undefined;
  if (!probe || typeof probe !== "object") errs.push("probe 缺失");
  else {
    if (typeof probe.ok !== "boolean") errs.push("probe.ok 必须是 boolean");
    if (typeof probe.source !== "string" || !probe.source) errs.push("probe.source 必须是非空字符串");
    if (probe.version !== undefined && typeof probe.version !== "string") errs.push("probe.version 必须是字符串");
    if (probe.error !== undefined && typeof probe.error !== "string") errs.push("probe.error 必须是字符串");
  }
  if (!Array.isArray(o.metrics)) errs.push("metrics 必须是数组");
  else {
    const emphases = o.metrics.filter(
      (m) => (m as Record<string, unknown>)?.emphasis === true,
    ).length;
    if (emphases > 1) errs.push("emphasis 主指标至多 1 个");
    for (const [i, m] of o.metrics.entries()) {
      const mm = m as Record<string, unknown>;
      if (!mm || typeof mm !== "object") { errs.push(`metrics[${i}] 必须是对象`); continue; }
      if (typeof mm.label !== "string" || !mm.label) errs.push(`metrics[${i}].label 必须是非空字符串`);
      if (typeof mm.value !== "string") errs.push(`metrics[${i}].value 必须是字符串`);
      if (mm.hint !== undefined && typeof mm.hint !== "string") errs.push(`metrics[${i}].hint 必须是字符串`);
    }
  }
  // SDK-4：条目形状逐层校验 —— 原只查「是数组」，tone 枚举/条目形状全漏
  //（与注释「用于适配器契约测试与插件数据边界」及 README 口径不符）。
  // tone 枚举与 ServiceStatus/ServiceListItem 接口对齐（ok|warn|error|info）。
  const TONES = new Set(["ok", "warn", "error", "info"]);
  const statuses = o.statuses;
  if (statuses !== undefined) {
    if (!Array.isArray(statuses)) errs.push("statuses 必须是数组");
    else {
      for (const [i, st] of statuses.entries()) {
        const s = st as Record<string, unknown>;
        if (!s || typeof s !== "object") {
          errs.push(`statuses[${i}] 必须是对象`);
          continue;
        }
        if (typeof s.text !== "string" || !s.text) errs.push(`statuses[${i}].text 必须是非空字符串`);
        if (!TONES.has(String(s.tone))) errs.push(`statuses[${i}].tone 必须是 ok|warn|error|info`);
      }
    }
  }
  const lists = o.lists;
  if (lists !== undefined) {
    if (!Array.isArray(lists)) errs.push("lists 必须是数组");
    else {
      for (const [i, li] of lists.entries()) {
        const l = li as Record<string, unknown>;
        if (!l || typeof l !== "object") {
          errs.push(`lists[${i}] 必须是对象`);
          continue;
        }
        if (typeof l.title !== "string" || !l.title) errs.push(`lists[${i}].title 必须是非空字符串`);
        if (!Array.isArray(l.items)) errs.push(`lists[${i}].items 必须是数组`);
        else {
          for (const [j, it] of l.items.entries()) {
            const t = it as Record<string, unknown>;
            if (!t || typeof t !== "object") {
              errs.push(`lists[${i}].items[${j}] 必须是对象`);
              continue;
            }
            if (typeof t.title !== "string" || !t.title) errs.push(`lists[${i}].items[${j}].title 必须是非空字符串`);
            if (t.detail !== undefined && typeof t.detail !== "string") errs.push(`lists[${i}].items[${j}].detail 必须是字符串`);
            if (t.tone !== undefined && !TONES.has(String(t.tone))) errs.push(`lists[${i}].items[${j}].tone 必须是 ok|warn|error|info`);
            if (t.at !== undefined && typeof t.at !== "string") errs.push(`lists[${i}].items[${j}].at 必须是字符串`);
          }
        }
      }
    }
  }
  const sample = o.sample as Record<string, unknown> | undefined;
  if (sample !== undefined) {
    if (!sample || typeof sample !== "object") errs.push("sample 必须是对象");
    else {
      if (typeof sample.at !== "string" || !sample.at) errs.push("sample.at 必须是非空字符串");
      const series = sample.series as Record<string, unknown> | undefined;
      if (!series || typeof series !== "object") errs.push("sample.series 必须是对象");
      else {
        for (const [k, val] of Object.entries(series)) {
          if (typeof val !== "number" || !Number.isFinite(val)) errs.push(`sample.series.${k} 必须是有限数值`);
        }
      }
    }
  }
  if (o.notes !== undefined) {
    if (!Array.isArray(o.notes)) errs.push("notes 必须是数组");
    else for (const [i, n] of o.notes.entries()) {
      if (typeof n !== "string" || !n) errs.push(`notes[${i}] 必须是非空字符串`);
    }
  }
  return errs;
}

/** LNT-2：类型守卫 —— 契约校验通过即收窄，调用点**零断言**（原 `as unknown as` 双断言会吞掉形状漂移）。 */
export function isServiceOverview(v: unknown): v is ServiceOverview {
  return validateServiceOverview(v).length === 0;
}

/** 空概览骨架（探活失败等降级路径统一使用）。 */
export function emptyOverview(source: string, error?: string): ServiceOverview {
  return { probe: { ok: false, source, error }, metrics: [], notes: error ? [error] : [] };
}
