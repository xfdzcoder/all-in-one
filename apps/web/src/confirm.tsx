import { useState } from "react";
import type { ReactNode } from "react";
import { ActionIcon, Button, Group, Modal, Text, Tooltip } from "@mantine/core";

/**
 * 破坏性操作二次确认（D31）：删除页面/列/卡片/账号/卸载插件等不可逆或丢数据的操作
 * 一律先弹确认（正文顺带说明数据边界），误触不丢东西。自动化友好：确认弹窗内
 * 按钮为「确认」/「取消」精确文本。Q65：icon 触发器（图标 + tooltip + sr-only）。
 */
export function ConfirmAction({
  label,
  message,
  onConfirm,
  color = "red",
  size = "xs",
  variant = "light",
  title = "确认操作",
  icon,
}: {
  label: string;
  message: string;
  onConfirm: () => void;
  color?: string;
  size?: "compact-xs" | "xs";
  variant?: "light" | "default" | "subtle" | "filled";
  /** 情境化标题（P2-8）："删除页面？"等短问句；缺省保持"确认操作"。 */
  title?: string;
  /** 图标触发器（Q65 文字按钮 icon 化）：提供时以图标按钮触发，保留 label 为可访问名。 */
  icon?: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      {icon ? (
        <Tooltip label={label} withinPortal>
          <ActionIcon variant="subtle" color={color} size="sm" aria-label={label} onClick={() => setOpened(true)}>
            {icon}
            <span className="wb-sr-only">{label}</span>
          </ActionIcon>
        </Tooltip>
      ) : (
        <Button size={size} color={color} variant={variant} onClick={() => setOpened(true)}>
          {label}
        </Button>
      )}
      {/* 条件挂载：Mantine 关闭态 Modal 会留空 root（Q4 教训），按需挂载避免 DOM 膨胀 */}
      {opened && (
        <Modal opened onClose={() => setOpened(false)} title={title} size="sm">
          <Text size="sm">{message}</Text>
          <Group gap="xs" mt="sm">
            <Button
              size="xs"
              color="red"
              onClick={() => {
                setOpened(false);
                onConfirm();
              }}
            >
              确认
            </Button>
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              取消
            </Button>
          </Group>
        </Modal>
      )}
    </>
  );
}
