import { Placeholder, StatBox } from "./widgets";

/** Component map for gridstack React wrapper (M2 replaces with widget-sdk registry). */
export const widgetComponents = { Placeholder, StatBox };

/** Local fallback layout when a dashboard has none / corrupt JSON (FR-P4 兜底). */
export const FALLBACK_LAYOUT = [
  { id: "fb-1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "欢迎", color: "#4a6fa5" } },
  { id: "fb-2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "状态", value: "OK" } },
  { id: "fb-3", x: 8, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "示例组件", color: "#4a7d6b" } },
];
