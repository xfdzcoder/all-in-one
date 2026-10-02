import { IconRefresh, IconInfoCircle } from "./icons";
import { useMemo, useState } from "react";
import { Badge, Button, Group, JsonInput, Modal, Stack, Table, Text } from "@mantine/core";
import { parseJsxTemplate } from "@all-in-one/widget-sdk";

import { useCustomApiData, useResolvedSourceConfig } from "./data-hooks";
import { copyText } from "./clipboard";
import { WbAlert, WbLoading, IconAction } from "./ui";
import { WidgetTitle } from "./widget-title";
import { ALLOWED_TAGS, JsxTemplateView } from "./jsx-template";

/**
 * 自定义 API Widget（D14：声明式白名单模板，无代码执行）。
 * 模板类型：stat（统计卡片）/ list（列表）/ status（状态点）/ raw（原始 JSON 兜底）。
 * 数据由服务端 http-connector 代取（SSRF + 凭证注入）。
 */
export type CustomApiConfig = {
  url?: string;
  method?: "GET" | "POST";
  display?: "stat" | "list" | "status" | "raw" | "jsx";
  /** display=jsx 时的受限 JSX 模板（D35）；绑定面 = data（完整响应）+ 安全子集。 */
  templateJsx?: string;
  /** 点路径取值（如 "data.items"）；空 = 根。 */
  path?: string;
  /** list/status 模式的字段名（如 "name"、"value"）。 */
  labelField?: string;
  valueField?: string;
  /** status 模式：该字段为真值时显示绿点。 */
  statusField?: string;
};

/** 点路径取值：`a.b.0.c`。 */
function pickPath(root: unknown, path?: string): unknown {
  if (!path) return root;
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** 嵌套值转摘要（P2-5：不再 JSON dump）：数组列前 3 项、对象列前 3 个键。
 *  纯函数上提模块级（consistent-function-scoping）——**实现原样搬运**，不改行为。 */
const summarize = (v: unknown): { value: string; hint?: string } => {
  if (Array.isArray(v)) {
    // 纯对象/嵌套数组没有可读的单项摘要 —— 只报条数，不输出「…、…」噪音
    const parts = v
      .slice(0, 3)
      .map((x) => (x && typeof x !== "object" ? String(x) : ""))
      .filter(Boolean);
    return {
      value: `${v.length} 项`,
      hint: parts.length > 0 ? parts.join("、") + (v.length > 3 ? "…" : "") : undefined,
    };
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    return { value: `${keys.length} 字段`, hint: keys.slice(0, 3).join("、") + (keys.length > 3 ? "…" : "") };
  }
  return { value: String(v ?? "") };
};

export function CustomApiWidget(props: CustomApiConfig) {
  // D42 + D65：认证来源（sourceId 提供 authHeader/apiToken）——**卡片已填 > 来源**
  // （不同才需填，填了只覆盖本卡）；相对 url 按来源站点地址拼接
  const resolved = useResolvedSourceConfig("http", props, ["authHeader", "apiToken"], {
    inlineWins: true,
    resolveRelativeUrl: true,
  });
  const display = props.display ?? "stat";
  const { data, loading, error, refresh } = useCustomApiData(resolved);
  const [detailOpen, setDetailOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // 三层展示（D35）：声明式预设 → 受限 JSX → Raw；模板解析失败显式报错不白屏
  const templateSrc = typeof props.templateJsx === "string" ? props.templateJsx : "";
  const parsed = useMemo(
    () => (display === "jsx" ? parseJsxTemplate(templateSrc, { allowedTags: ALLOWED_TAGS }) : null),
    [display, templateSrc],
  );

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <WidgetTitle title="自定义 API" />
        <Group gap={6} wrap="nowrap" className="wb-widget__actions">
          {data !== undefined && data !== null && (
            <IconAction label="详情" onClick={() => setDetailOpen(true)}><IconInfoCircle size={14} /></IconAction>
          )}
          <IconAction label="刷新" onClick={refresh}><IconRefresh size={14} /></IconAction>
        </Group>
      </Group>
      {loading && <WbLoading />}
      {error && <WbAlert tone="error" size="sm">{error}</WbAlert>}
      {!loading && !error && display === "jsx" && parsed && parsed.errors.length > 0 && (
        <WbAlert tone="error" size="sm">模板错误（D35 校验拒绝）：{parsed.errors.join("；")}</WbAlert>
      )}
      {!loading && !error && display === "jsx" && parsed?.tree && (
        <JsxTemplateView tree={parsed.tree} data={data} />
      )}
      {!loading && !error && display !== "jsx" && (
        <ApiDisplay display={display} data={pickPath(data, props.path)} config={props} />
      )}
      {detailOpen && (
        <Modal opened onClose={() => setDetailOpen(false)} title="详情 · 完整响应（FR-I4）" size="lg">
          <Group justify="flex-end" mb="xs">
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                // ISS-25：2s 复位 + 失败显式提示。
                // Q80：改用 copyText —— 直接调 navigator.clipboard 在 HTTP（非安全上下文）
                // 下会同步抛（clipboard 是 undefined），`.catch()` 接不住。
                void copyText(JSON.stringify(data, null, 2)).then((ok) => {
                  setCopied(ok);
                  if (ok) setTimeout(() => setCopied(false), 2000);
                  return ok; // promise(always-return)：链式语义明确
                });
              }}
            >
              {copied ? "已复制" : "复制 JSON"}
            </Button>
          </Group>
          <JsonInput
            className="wb-code"
            value={JSON.stringify(data, null, 2)}
            readOnly
            autosize
            minRows={6}
            maxRows={20}
            size="xs"
          />
        </Modal>
      )}
    </div>
  );
}

function ApiDisplay({
  display,
  data,
  config,
}: {
  display: NonNullable<CustomApiConfig["display"]>;
  data: unknown;
  config: CustomApiConfig;
}) {
  if (data === undefined || data === null) return <Text size="xs" c="dimmed">无数据</Text>;

  switch (display) {
    case "raw":
      return (
        <JsonInput
          value={JSON.stringify(data, null, 2)}
          readOnly
          autosize
          minRows={4}
          maxRows={12}
          size="xs"
        />
      );
    case "status": {
      const items = Array.isArray(data) ? data : [data];
      return (
        <Stack gap={4}>
          {items.slice(0, 20).map((it, i) => {
            const rec = (it ?? {}) as Record<string, unknown>;
            const label = String(rec[config.labelField ?? "name"] ?? `#${i}`);
            const ok = config.statusField ? Boolean(rec[config.statusField]) : true;
            return (
              <Group key={i} gap="xs">
                <Badge size="xs" color={ok ? "green" : "red"} circle>
                  &nbsp;
                </Badge>
                <Text size="xs">{label}</Text>
              </Group>
            );
          })}
        </Stack>
      );
    }
    case "list": {
      const items = Array.isArray(data) ? data : [data];
      return (
        <Table>
          <Table.Tbody>
            {items.slice(0, 20).map((it, i) => {
              const rec = (it ?? {}) as Record<string, unknown>;
              return (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Text size="xs">{String(rec[config.labelField ?? "name"] ?? `#${i}`)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{String(rec[config.valueField ?? "value"] ?? "")}</Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      );
    }
    case "stat":
    default: {
      // 根为对象 → 键值统计卡；数组 → 前 6 项的 label/value（P2-5：标签在上、数值大）
      type StatCard = { key: string; label: string; value: string; hint?: string };
      const cards: StatCard[] = Array.isArray(data)
        ? data.slice(0, 6).map((it, i) => {
            const rec = (it ?? {}) as Record<string, unknown>;
            return { key: `#${i}`, label: String(rec[config.labelField ?? "name"] ?? `#${i}`), ...summarize(rec[config.valueField ?? "value"]) };
          })
        : Object.entries((data ?? {}) as Record<string, unknown>)
            .slice(0, 6)
            .map(([k, v]) => ({ key: k, label: k, ...summarize(v) }));
      return (
        <div className="wb-stat-grid">
          {cards.map((c) => (
            <div key={c.key} className="wb-metric">
              <div className="wb-metric__label">{c.label}</div>
              <div className="wb-metric__value">{c.value}</div>
              {c.hint && <div className="wb-metric__hint">{c.hint}</div>}
            </div>
          ))}
        </div>
      );
    }
  }
}
