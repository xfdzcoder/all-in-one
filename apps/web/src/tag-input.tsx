import { useState } from "react";
import { TagsInput } from "@mantine/core";

import type { TagRow } from "./api";
import { useTagMutations } from "./data-hooks";

/**
 * 标签输入（Q25c/#3）：输入即搜索已有标签、**回车直接创建并选中**、chips 可删。
 * 值模型 = 标签名（TagsInput 语义），保存时解析为 tagId：
 * - 已有名字 → 直接映射 id；
 * - 新名字 → 调用创建接口后取回 id（创建即选中）。
 */
export function TagInput({
  tags,
  value,
  onChange,
  placeholder = "标签",
  width,
}: {
  tags: TagRow[];
  value: string[];
  onChange: (tagIds: string[]) => void;
  placeholder?: string;
  width?: number;
}) {
  const tagMut = useTagMutations();
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => tags.find((t) => t.id === id)?.name ?? id;
  const idOf = (name: string) => tags.find((t) => t.name === name)?.id;

  const applyNames = async (names: string[]) => {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const name of names) {
        const existing = idOf(name);
        if (existing) {
          ids.push(existing);
          continue;
        }
        // 回车新名字 = 创建标签并选中（Q25c/#3）
        const created = await tagMut.create.mutateAsync({ name });
        if (created?.id) ids.push(created.id);
      }
      onChange(ids);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TagsInput
      size="xs"
      placeholder={placeholder}
      style={width ? { width } : undefined}
      data={tags.map((t) => t.name)}
      value={value.map(nameOf)}
      onChange={(names) => void applyNames(names)}
      disabled={busy}
      allowDuplicates={false}
      clearable
    />
  );
}
