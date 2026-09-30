import { useMemo, useState } from "react";
import { Alert, Badge, Button, Group, JsonInput, Modal, Stack, Table, Text } from "@mantine/core";
import { parseJsxTemplate } from "@all-in-one/widget-sdk";

import { useCustomApiData } from "./data-hooks";
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

export function CustomApiWidget(props: CustomApiConfig) {
  const display = props.display ?? "stat";
  const { data, loading, error, refresh } = useCustomApiData(props);
  const [detailOpen, setDetailOpen] = useState(false);

  // 三层展示（D35）：声明式预设 → 受限 JSX → Raw；模板解析失败显式报错不白屏
  const templateSrc = typeof props.templateJsx === "string" ? props.templateJsx : "";
  const parsed = useMemo(
    () => (display === "jsx" ? parseJsxTemplate(templateSrc, { allowedTags: ALLOWED_TAGS }) : null),
    [display, templateSrc],
  );

  return (
    <div className="wb-widget">
      <Group gap={6}>
        <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
          自定义 API
        </Text>
        {data !== undefined && data !== null && (
          <Button size="compact-xs" variant="subtle" onClick={() => setDetailOpen(true)}>
            详情
          </Button>
        )}
        <Button size="compact-xs" variant="subtle" onClick={refresh}>
          刷新
        </Button>
      </Group>
      {loading && <Text size="xs" c="dimmed">加载中…</Text>}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
      {!loading && !error && display === "jsx" && parsed && parsed.errors.length > 0 && (
        <Alert color="red">
          <Text size="xs">模板错误（D35 校验拒绝）：{parsed.errors.join("；")}</Text>
        </Alert>
      )}
      {!loading && !error && display === "jsx" && parsed?.tree && (
        <JsxTemplateView tree={parsed.tree} data={data} />
      )}
      {!loading && !error && display !== "jsx" && (
        <ApiDisplay display={display} data={pickPath(data, props.path)} config={props} />
      )}
      {detailOpen && (
        <Modal opened onClose={() => setDetailOpen(false)} title="详情 · 完整响应（FR-I4）" size="lg">
          <JsonInput value={JSON.stringify(data, null, 2)} readOnly autosize minRows={6} maxRows={20} size="xs" />
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
      // 根为对象 → 键值卡片；数组 → 前 6 项的 label/value
      if (Array.isArray(data)) {
        return (
          <Group gap="xs">
            {data.slice(0, 6).map((it, i) => {
              const rec = (it ?? {}) as Record<string, unknown>;
              return (
                <div key={i} className="stat">
                  <div className="stat-label">{String(rec[config.labelField ?? "name"] ?? `#${i}`)}</div>
                  <div className="stat-value">{String(rec[config.valueField ?? "value"] ?? "")}</div>
                </div>
              );
            })}
          </Group>
        );
      }
      const entries = Object.entries((data ?? {}) as Record<string, unknown>).slice(0, 6);
      return (
        <Group gap="xs">
          {entries.map(([k, v]) => (
            <div key={k} className="stat">
              <div className="stat-label">{k}</div>
              <div className="stat-value">{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
            </div>
          ))}
        </Group>
      );
    }
  }
}
