import { useContext } from "react";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@mantine/core";
import { useGridStackItem } from "gridstack/dist/react";

import { WidgetEditContext } from "./widget-edit-context";

/**
 * 编辑态组件外框（FR-W4 生命周期"配置变更"收口）：
 * 任意组件（含零代码组件）在编辑模式获得「配置」入口，点击后由宿主打开该实例
 * 的 configSchema 配置表单；浏览模式 / 移动端不渲染（FR-P7/P8、D10）。
 * 外框是宿主能力，组件实现无需感知（"新增组件不改核心"）。
 */

export function WidgetChrome({ children }: { children: ReactNode }) {
  const { editMode, onConfigure } = useContext(WidgetEditContext);
  const { id } = useGridStackItem();

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      {/* 编辑态组件内容整体惰性（inert + pointer-events）：拖动 = 调整布局，
          禁止误操作卡片（FR-P8 编辑/浏览分离）；「配置」入口在外层保持可用 */}
      <div
        style={{ height: "100%", pointerEvents: editMode ? "none" : "auto" }}
        inert={editMode || undefined}
      >
        {children}
      </div>
      {editMode && (
        <Button
          size="compact-xs"
          variant="light"
          color="gray"
          onClick={() => onConfigure(String(id))}
          style={{ position: "absolute", top: 4, right: 4, zIndex: 5 }}
        >
          配置
        </Button>
      )}
    </div>
  );
}

/** 给任意组件包上编辑态外框（注册表统一套用，组件本身零改动）。 */
// oxlint-disable-next-line react/only-export-components -- HOC 与组件同文件便于维护
export function withWidgetChrome<P extends Record<string, unknown>>(Comp: ComponentType<P>): ComponentType<P> {
  function Wrapped(props: P) {
    return (
      <WidgetChrome>
        <Comp {...props} />
      </WidgetChrome>
    );
  }
  Wrapped.displayName = `withWidgetChrome(${Comp.displayName ?? Comp.name ?? "Widget"})`;
  return Wrapped;
}
