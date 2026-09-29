import { createContext } from "react";

/**
 * 宿主服务上下文：组件外框据此渲染「配置」入口（宿主能力，组件实现零感知）；
 * `requestSave` 供组件改写自身配置（props）后触发布局持久化（FR-P4）。
 */
export const WidgetEditContext = createContext<{
  editMode: boolean;
  onConfigure: (id: string) => void;
  requestSave: () => void;
}>({ editMode: false, onConfigure: () => {}, requestSave: () => {} });
