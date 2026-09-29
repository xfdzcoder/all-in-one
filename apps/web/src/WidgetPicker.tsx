import { useState } from "react";
import { Badge, Button, Group, Modal, SimpleGrid, Stack, Text } from "@mantine/core";
import type { ConfigValues, WidgetManifest } from "@all-in-one/widget-sdk";

import { builtinManifests } from "./widget-registry";
import { ConfigForm } from "./ConfigForm";
import { defaultsFromSchema } from "./config-form-utils";

/**
 * 组件选择器（FR-W1 manifest 清单 + FR-W2 configSchema 驱动表单）。
 * 两步：① 从 builtinManifests 选组件（清单驱动渲染，含名称/描述/分类）；
 * ② 按该 manifest 的 configSchema 生成配置表单（默认值预填）→ 确认添加。
 * 新增组件只需注册 manifest + 渲染实现，选择器无需改动（J8"新增组件不改核心"）。
 */
export function WidgetPicker({
  opened,
  onClose,
  onAdd,
  extraManifests = [],
}: {
  opened: boolean;
  onClose: () => void;
  onAdd: (manifest: WidgetManifest, values: ConfigValues) => Promise<void> | void;
  /** 启用中的插件 manifest（与内置清单合并展示，J8：清单由 manifest 驱动）。 */
  extraManifests?: WidgetManifest[];
}) {
  const [selected, setSelected] = useState<WidgetManifest | null>(null);
  const [values, setValues] = useState<ConfigValues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (m: WidgetManifest) => {
    setSelected(m);
    setValues(defaultsFromSchema(m.configSchema));
    setError(null);
  };

  const close = () => {
    setSelected(null);
    setError(null);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title={selected ? `添加组件 · ${selected.name}` : "添加组件"} size="lg">
      {!selected && (
        <SimpleGrid cols={2} spacing="xs">
          {[...builtinManifests, ...extraManifests].map((m) => (
            <Button
              key={m.type}
              variant="light"
              onClick={() => pick(m)}
              styles={{ inner: { justifyContent: "flex-start" } }}
            >
              <Stack gap={2} align="flex-start">
                <Group gap={6}>
                  <Text size="sm" fw={600}>
                    {m.name}
                  </Text>
                  <Badge size="xs" variant="outline">
                    {m.category}
                  </Badge>
                </Group>
                {m.description && (
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "normal", textAlign: "left" }}>
                    {m.description}
                  </Text>
                )}
              </Stack>
            </Button>
          ))}
        </SimpleGrid>
      )}
      {selected && (
        <Stack gap="xs">
          <Group gap="xs">
            <Button size="xs" variant="subtle" onClick={() => setSelected(null)}>
              ← 返回
            </Button>
            <Badge size="xs" variant="light">
              {selected.category}
            </Badge>
            {selected.description && (
              <Text size="xs" c="dimmed">
                {selected.description}
              </Text>
            )}
          </Group>
          <ConfigForm
            schema={selected.configSchema}
            values={values}
            onChange={(key, value) => setValues((c) => ({ ...c, [key]: value }))}
            onSubmit={(v) => {
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await onAdd(selected, v);
                  close();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              })();
            }}
            submitLabel={busy ? "添加中…" : "确认添加"}
            refresh={selected.capabilities?.refresh}
          />
          {error && (
            <Text size="xs" c="red">
              {error}
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
