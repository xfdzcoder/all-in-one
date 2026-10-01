import { useContext } from "react";
import type { ComponentType, ReactNode } from "react";
import { IconSettings, IconTrash } from "@tabler/icons-react";
import { useGridStack, useGridStackItem } from "gridstack/dist/react";

import { WidgetEditContext } from "./widget-edit-context";
import { WidgetErrorBoundary } from "./error-boundary";
import { IconAction } from "./ui";

/**
 * 编辑态组件外框（FR-W4 生命周期"配置变更"收口）：
 * 任意组件（含零代码组件）在编辑模式获得「配置」/「移除」入口，浏览模式 / 移动端不渲染
 * （FR-P7/P8、D10）。外框是宿主能力，组件实现无需感知（"新增组件不改核心"）。
 * 「移除」为 ISS-6 修复：点谁移除谁（替代语义错位的"删除最后"）；布局编辑内移除
 * 按 D31 豁免确认（不动业务数据）。
 */

export function WidgetChrome({ children }: { children: ReactNode }) {
  const { editMode, onConfigure } = useContext(WidgetEditContext);
  const { id, node } = useGridStackItem();
  const { grid, removeWidget } = useGridStack();

  return (
    <div className="wb-chrome">
      {/* 编辑态组件内容整体惰性（inert + pointer-events）：拖动 = 调整布局，
          禁止误操作卡片（FR-P8 编辑/浏览分离）；「配置/移除」入口在外层保持可用 */}
      <div
        className={`wb-chrome__content${editMode ? " wb-chrome__content--inert" : ""}`}
        inert={editMode || undefined}
      >
        {children}
      </div>
      {editMode && (
        <div className="wb-chrome__actions">
          <IconAction label="配置" onClick={() => onConfigure(String(id))}>
            <IconSettings size={14} />
          </IconAction>
          <IconAction
            label="移除"
            danger
            tooltip="移除卡片（数据保留，可在「数据源管理」查看或删除）"
            onClick={() => {
              const el = node?.el;
              if (el && grid) removeWidget(el);
            }}
          >
            <IconTrash size={14} />
          </IconAction>
        </div>
      )}
    </div>
  );
}

/** 给任意组件包上编辑态外框（注册表统一套用，组件本身零改动）。 */
// oxlint-disable-next-line react/only-export-components -- HOC 与组件同文件便于维护
export function withWidgetChrome<P extends Record<string, unknown>>(Comp: ComponentType<P>): ComponentType<P> {
  const label = Comp.displayName ?? Comp.name ?? "组件";
  function Wrapped(props: P) {
    return (
      <WidgetChrome>
        {/* Q93（项 1）：边界在 chrome **内**、组件**外** —— 崩了也保留标题栏与「移除」按钮 */}
        <WidgetErrorBoundary name={label}>
          <Comp {...props} />
        </WidgetErrorBoundary>
      </WidgetChrome>
    );
  }
  Wrapped.displayName = `withWidgetChrome(${Comp.displayName ?? Comp.name ?? "Widget"})`;
  return Wrapped;
}
