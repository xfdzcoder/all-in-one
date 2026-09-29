import type { ConfigSchema, ConfigValues, SecretRef } from "@all-in-one/widget-sdk";

import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";

import { validateForm } from "./config-form-utils";

/**
 * FR-W2：由 configSchema 驱动的配置表单（widget-agnostic）。
 * secret 字段走凭证引用（值 = {credentialRef}），此处以 credentialId 输入呈现。
 */
export function ConfigForm({
  schema,
  values,
  onChange,
  onSubmit,
  submitLabel = "保存配置",
}: {
  schema: ConfigSchema;
  values: ConfigValues;
  onChange: (key: string, value: unknown) => void;
  onSubmit: (values: ConfigValues) => void;
  submitLabel?: string;
}) {
  const submit = () => {
    const errors = validateForm(schema, values);
    if (errors.length === 0) onSubmit(values);
    else alert(errors.map((e) => e.message).join("\n"));
  };

  return (
    <Stack gap="xs">
      {schema.map((f) => {
        const v = values[f.key];
        switch (f.type) {
          case "boolean":
            return (
              <Checkbox
                key={f.key}
                label={f.label}
                checked={Boolean(v)}
                onChange={(e) => onChange(f.key, e.currentTarget.checked)}
              />
            );
          case "number":
            return (
              <NumberInput
                key={f.key}
                label={f.label}
                size="xs"
                value={typeof v === "number" ? v : ""}
                onChange={(nv) => onChange(f.key, typeof nv === "number" ? nv : undefined)}
              />
            );
          case "select":
            return (
              <Select
                key={f.key}
                label={f.label}
                size="xs"
                data={f.options ?? []}
                value={typeof v === "string" ? v : null}
                onChange={(nv) => onChange(f.key, nv ?? undefined)}
              />
            );
          case "json":
            return (
              <Textarea
                key={f.key}
                label={f.label}
                size="xs"
                minRows={4}
                value={typeof v === "string" ? v : v !== undefined ? JSON.stringify(v, null, 2) : ""}
                onChange={(e) => onChange(f.key, e.currentTarget.value)}
              />
            );
          case "secret": {
            // 编辑期持明文字符串；提交时由宿主入库凭证库并替换为 SecretRef（SEC3）。
            const shown = typeof v === "string" ? v : (v as SecretRef | undefined)?.credentialRef ?? "";
            return (
              <Group key={f.key} gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  label={f.label}
                  size="xs"
                  type="password"
                  style={{ flex: 1 }}
                  placeholder="保存时写入凭证库（明文不进配置）"
                  value={shown}
                  onChange={(e) => onChange(f.key, e.currentTarget.value)}
                />
                <Text size="xs" c="dimmed">
                  SEC3
                </Text>
              </Group>
            );
          }
          default:
            return (
              <TextInput
                key={f.key}
                label={f.label}
                size="xs"
                placeholder={f.placeholder}
                value={typeof v === "string" ? v : ""}
                onChange={(e) => onChange(f.key, e.currentTarget.value)}
              />
            );
        }
      })}
      <Button size="xs" onClick={submit}>
        {submitLabel}
      </Button>
    </Stack>
  );
}
