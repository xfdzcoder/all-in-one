import { Badge, Button, Group, JsonInput, Stack, Table, Text } from "@mantine/core";

import { useCustomApiData } from "./data-hooks";

/**
 * 自定义 API Widget（D14：声明式白名单模板，无代码执行）。
 * 模板类型：stat（统计卡片）/ list（列表）/ status（状态点）/ raw（原始 JSON 兜底）。
 * 数据由服务端 http-connector 代取（SSRF + 凭证注入）。
 */
export type CustomApiConfig = {
  url?: string;
  method?: "GET" | "POST";
  display?: "stat" | "list" | "status" | "raw";
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

  return (
    <Stack gap={4} style={{ height: "100%", overflow: "auto", padding: 4 }}>
      <Group gap={6}>
        <Text size="xs" fw={600} style={{ flex: 1 }} truncate>
          自定义 API
        </Text>
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
      {!loading && !error && <ApiDisplay display={display} data={pickPath(data, props.path)} config={props} />}
    </Stack>
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
