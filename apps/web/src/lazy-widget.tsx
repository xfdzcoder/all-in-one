import { Suspense, lazy, type ComponentType } from "react";

import { WbLoading } from "./ui";

/**
 * 大件组件懒加载容器（Q115 批1：dev 脚本体积治理）。
 *
 * ECharts（~10MB）、CodeMirror（~3MB）这类重依赖只在**真正渲染时**才加载 ——
 * 首屏 JS 与 DevTools 的脚本解析/索引压力都随之下降；也顺带缩小生产主包（维度⑪）。
 * 用法：`lazyWidget(() => import("./x").then((m) => ({ default: m.X })))`。
 */
export function lazyWidget<P extends Record<string, unknown>>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  const Lazy = lazy(load);
  return function LazyWidget(props: P) {
    return (
      <Suspense fallback={<WbLoading />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
