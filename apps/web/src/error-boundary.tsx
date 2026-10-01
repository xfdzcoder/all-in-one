import { Component, type ReactNode } from "react";

/**
 * Q93（项 1）：**组件级错误边界**。
 *
 * 背景：全仓原本**没有一处 ErrorBoundary**，任何单个组件在 render 期抛错都会把整棵 React
 * 树卸载 —— 整页白屏，且因为下次渲染还会再抛，**永远无法恢复**（连把出错卡片删掉都做不到）。
 *
 * 边界放在 `withWidgetChrome` 内部、`WidgetChrome` 外部：外层的卡片标题栏与动作簇
 * （含编辑态的「移除」）**不受影响**，用户总能把坏卡片删掉。
 *
 * 崩溃信息按 08 §5「原因 + 怎么修」给：真实错误消息 + 怎么办，而不是一句「出错了」。
 */
export class WidgetErrorBoundary extends Component<
  { name?: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // 组件渲染崩溃必须留痕，否则线上只有白屏无从排查
    console.error("[widget] render failed:", this.props.name ?? "widget", error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="wb-widget__crash">
        <div className="wb-widget__crash-title">「{this.props.name ?? "组件"}」渲染失败</div>
        <div className="wb-widget__crash-msg">{String(error.message ?? error)}</div>
        <div className="wb-widget__hint">
          页面没有崩，只有这个组件停了。可在编辑态点卡片右上角「移除」删掉它，或改配置后刷新。
        </div>
      </div>
    );
  }
}
