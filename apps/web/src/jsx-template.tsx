import type { ComponentType, ReactNode } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Center,
  Code,
  Divider,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Space,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { TemplateNode } from "@all-in-one/widget-sdk";

/**
 * 受限 JSX 渲染层（D35）：把 widget-sdk 解析出的节点树渲染为 **白名单 Mantine 组件**。
 * 校验（widget-sdk parseJsxTemplate）已保证：只会出现下列组件、只允许白名单 props、
 * 无事件处理器；此处仅做树 → 元素映射（不执行任何字符串代码）。
 */

/** 白名单组件的 props 形态各异 —— 统一按「未知键值对象」调用（校验层已限制可传属性）。
 *  LNT-2：原 `ComponentType<any>` 抹掉全部组件 props 类型，改为显式 `Record<string, unknown>`。 */
type JsxProps = Record<string, unknown>;

/** LNT-2：Mantine 各组件 props 形态不同（strictFunctionTypes 下无法直接赋给统一签名）——
 *  在此**单点**放宽为 `Record<string, unknown>`；真正的防线是模板校验层的属性白名单（D35）。
 *  比通篇 `ComponentType<any>` 诚实：逃逸面收敛到一个函数。 */
const asJsxComponent = (c: unknown): ComponentType<JsxProps> => c as ComponentType<JsxProps>;

const COMPONENTS: Record<string, ComponentType<JsxProps>> = {
  Stack: asJsxComponent(Stack),
  Group: asJsxComponent(Group),
  SimpleGrid: asJsxComponent(SimpleGrid),
  Center: asJsxComponent(Center),
  Space: asJsxComponent(Space),
  Text: asJsxComponent(Text),
  Title: asJsxComponent(Title),
  Code: asJsxComponent(Code),
  Badge: asJsxComponent(Badge),
  Card: asJsxComponent(Card),
  Paper: asJsxComponent(Paper),
  Alert: asJsxComponent(Alert),
  Progress: asJsxComponent(Progress),
  Anchor: asJsxComponent(Anchor),
  Divider: asJsxComponent(Divider),
};

/** 校验用白名单（与渲染映射同源）。 */
// oxlint-disable-next-line react/only-export-components -- 白名单常量与渲染映射同源，拆开反而易漂移
export const ALLOWED_TAGS: readonly string[] = Object.keys(COMPONENTS);

function renderNode(node: TemplateNode, data: unknown, key: number): ReactNode {
  if (node.kind === "text") return node.value;
  if (node.kind === "exprChildren") {
    const child = node.render(data);
    return child ? renderNode(child, data, key) : null;
  }
  if (node.kind === "element") {
    if (node.tag === "__expr_text") {
      const v = (node.props.value as { evaluate: (d: unknown) => unknown }).evaluate(data);
      return v === null || v === undefined ? null : String(v);
    }
    if (node.tag === "__fragment") {
      return <span key={key}>{node.children.map((c, i) => renderNode(c, data, i))}</span>;
    }
    const Comp = COMPONENTS[node.tag];
    if (!Comp) return null;
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.props)) {
      props[k] = v.kind === "literal" ? v.value : v.evaluate(data);
    }
    return (
      <Comp key={key} {...props}>
        {node.children.map((c, i) => renderNode(c, data, i))}
      </Comp>
    );
  }
  return null;
}

export function JsxTemplateView({ tree, data }: { tree: TemplateNode; data: unknown }) {
  return <>{renderNode(tree, data, 0)}</>;
}
