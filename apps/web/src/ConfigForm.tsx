import type { ConfigSchema, ConfigValues, SecretRef } from "@all-in-one/widget-sdk";

import {
  Button,
  Checkbox,
  MultiSelect,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";

import { useState } from "react";

import { validateForm } from "./config-form-utils";
import { useDynamicOptionsMap } from "./data-hooks";
import { WbAlert } from "./ui";

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
  refresh,
}: {
  schema: ConfigSchema;
  values: ConfigValues;
  onChange: (key: string, value: unknown) => void;
  onSubmit: (values: ConfigValues) => void;
  submitLabel?: string;
  /** FR-I2/I3：组件声明了刷新能力时，表单附带标准"刷新频率"字段（存 props.refreshSec）。 */
  refresh?: { minRefreshSec?: number; defaultRefreshSec?: number };
}) {
  // ISS-23 修复：校验失败内联提示（不再浏览器 alert）
  const [formError, setFormError] = useState<string | null>(null);
  // Q26b：select.dynamic 动态选项（看板/数据连接下拉）
  // Q72/D57：`dependsOn` —— 选项随另一字段（通常是 sourceId）变化：换连接即换选项源 key → 自动重取
  const depField = schema.find((f) => f.dependsOn && f.dynamic);
  const scopeSourceId = depField?.dependsOn ? String(values[depField.dependsOn] ?? "") : "";
  const dynamicOptions = useDynamicOptionsMap(scopeSourceId, depField?.dynamic);
  const optionsFor = (f: { key: string; dynamic?: string; dependsOn?: string; options?: Array<{ value: string; label: string }> }) => {
    if (!f.dynamic) return f.options ?? [];
    const key = f.dependsOn ? `${f.dynamic}:${String(values[f.dependsOn] ?? "")}` : f.dynamic;
    return dynamicOptions[key] ?? [];
  };
  const submit = () => {
    const errors = validateForm(schema, values);
    if (errors.length === 0) {
      setFormError(null);
      onSubmit(values);
    } else {
      setFormError(errors.map((e) => e.message).join("；"));
    }
  };

  return (
    <Stack gap="xs">
      {formError && (
        <WbAlert tone="error" size="sm" onClose={() => setFormError(null)}>
          {formError}
        </WbAlert>
      )}
      {schema.map((f) => {
        const v = values[f.key];
        switch (f.type) {
          case "textarea":
            return (
              <Textarea
                key={f.key}
                label={f.label}
                size="xs"
                minRows={4}
                placeholder={f.placeholder}
                value={typeof v === "string" ? v : ""}
                onChange={(e) => onChange(f.key, e.currentTarget.value)}
              />
            );
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
          case "multiselect":
            return (
              <MultiSelect
                key={f.key}
                label={f.label}
                size="xs"
                data={optionsFor(f)}
                value={Array.isArray(v) ? (v as string[]) : []}
                onChange={(nv) => onChange(f.key, nv)}
                placeholder={f.placeholder}
                description={f.help}
                clearable
              />
            );
          case "select": {
            if (f.creatable && f.dynamic) {
              return (
                <CreatableSelect
                  key={f.key}
                  label={f.label}
                  options={optionsFor(f)}
                  value={typeof v === "string" ? v : ""}
                  onChange={(nv) => onChange(f.key, nv || undefined)}
                  placeholder={f.placeholder}
                  description={f.help}
                />
              );
            }
            return (
              <Select
                key={f.key}
                label={f.label}
                size="xs"
                data={optionsFor(f)}
                value={typeof v === "string" ? v : null}
                onChange={(nv) => onChange(f.key, nv ?? undefined)}
              />
            );
          }
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
                  className="wb-flex-1"
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
      {refresh && (
        <NumberInput
          label="刷新频率（秒）"
          size="xs"
          min={refresh.minRefreshSec ?? 0}
          placeholder={`留空 = 默认 ${refresh.defaultRefreshSec ?? 60} 秒`}
          value={typeof values.refreshSec === "number" ? values.refreshSec : ""}
          onChange={(nv) => onChange("refreshSec", typeof nv === "number" ? nv : undefined)}
        />
      )}
      <Button size="xs" onClick={submit}>
        {submitLabel}
      </Button>
    </Stack>
  );
}

/** Q29b：可选已有或输入新建（Mantine v9 无内建 creatable —— 搜索无匹配时注入「＋ 新建」项）。 */
function CreatableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  description,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  description?: string;
}) {
  const [query, setQuery] = useState("");
  const data = [...options];
  // 已选的新建值不在已有列表 → 保持为可显示选项
  if (value && !options.some((o) => o.value === value)) data.push({ value, label: value });
  // 搜索无匹配 → 注入「＋ 新建」
  if (query && query !== value && !options.some((o) => o.value === query)) {
    data.push({ value: query, label: `＋ 新建「${query}」` });
  }
  return (
    <Select
      label={label}
      size="xs"
      searchable
      data={data}
      value={value || null}
      onChange={(nv) => {
        onChange(nv ?? "");
        setQuery("");
      }}
      searchValue={query}
      onSearchChange={setQuery}
      placeholder={placeholder}
      description={description}
      nothingFoundMessage="输入名称可新建"
    />
  );
}
