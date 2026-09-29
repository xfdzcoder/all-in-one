import { createContext } from "react";

/** 编辑态上下文：组件外框据此渲染「配置」入口（宿主能力，组件实现零感知）。 */
export const WidgetEditContext = createContext<{
  editMode: boolean;
  onConfigure: (id: string) => void;
}>({ editMode: false, onConfigure: () => {} });
