import { Parser } from "acorn";
import acornJsx from "acorn-jsx";

/**
 * 受限 JSX 模板（**D35：Homarr 模式 —— 模板是数据不是代码**）。
 *
 * 边界（D35 冻结）：
 * - 仅白名单组件（由宿主渲染映射给出）；事件处理器（on*）、dangerous 属性/标签一律拒绝；
 * - 绑定面 = `data` + 安全子集（String/Number/Boolean、Math、JSON、Array/Object 无害方法）；
 * - 标识符**允许名单制**：表达式里除安全库与 data 外出现任何标识符即拒绝
 *   （eval/Function/import/require/globalThis/window/document/fetch 天然不可达）；
 * - 危险属性名（constructor/__proto__/prototype/call/apply/bind…）拒绝；
 * - href 仅 `https://`、相对路径、`#`；
 * - 模板体积上限 64KB；解析/校验失败返回错误列表（宿主显式提示，不白屏）。
 *
 * 产物是**节点树 + 求值闭包**（非可执行代码串）：渲染层只消费树，永不 eval。
 */

const parser = Parser.extend(acornJsx());

export const TEMPLATE_MAX_BYTES = 64 * 1024;

/** 组件白名单由宿主提供（渲染映射同源）；此处校验 tag 是否在名单内。 */
export interface ParseOptions {
  allowedTags: readonly string[];
  /** 可透传的 props 白名单（大小写敏感）。 */
  allowedProps?: readonly string[];
}

export type TemplateNode =
  | { kind: "element"; tag: string; props: Record<string, TemplateValue>; children: TemplateNode[] }
  | { kind: "text"; value: string }
  /** 条件/短路渲染的子元素表达式（{cond ? <X/> : <Y/>}、{cond && <X/>}）。 */
  | { kind: "exprChildren"; render: (data: unknown) => TemplateNode | null };

export type TemplateValue =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "expr"; evaluate: (data: unknown) => unknown };

export interface ParseResult {
  tree: TemplateNode | null;
  errors: string[];
}

const DEFAULT_ALLOWED_PROPS = [
  "size",
  "variant",
  "color",
  "radius",
  "fw",
  "fs",
  "c",
  "ta",
  "order",
  "truncate",
  "lineClamp",
  "lh",
  "lts",
  "gap",
  "wrap",
  "justify",
  "align",
  "cols",
  "spacing",
  "display",
  "mt",
  "mb",
  "mx",
  "my",
  "p",
  "px",
  "py",
  "href",
  "value",
  "label",
  "w",
  "maw",
] as const;

/** 属性/标识符危险名：经典逃逸面（原型链、调用劫持）。 */
const DANGEROUS_KEYS = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "call",
  "apply",
  "bind",
  "toString",
  "valueOf",
  "then",
]);

/** 允许的根标识符（绑定面）：data 与安全库。 */
const SAFE_ROOTS = new Set(["data", "String", "Number", "Boolean", "Math", "JSON", "Array", "Object"]);

/** 允许的库方法（安全子集）。 */
const SAFE_METHODS = new Set([
  "round",
  "floor",
  "ceil",
  "abs",
  "min",
  "max",
  "pow",
  "sqrt",
  "toFixed",
  "stringify",
  "isArray",
  "keys",
  "values",
  "entries",
  "concat",
  "join",
  "slice",
  "includes",
  "indexOf",
  "map",
  "filter",
  "length",
  "toUpperCase",
  "toLowerCase",
  "trim",
]);

/** 内层源码级拒绝名单（纵深防御：允许名单已足够，此为二道闸）。 */
const FORBIDDEN_SOURCE = [
  "eval",
  "Function",
  "import",
  "require",
  "globalThis",
  "window",
  "document",
  "fetch",
  "process",
  "XMLHttpRequest",
  "WebSocket",
];

export type CompiledExpr = (data: unknown) => unknown;

interface Ctx {
  errors: string[];
  allowedTags: readonly string[];
  allowedProps: readonly string[];
}

function fail(ctx: Ctx, msg: string): void {
  if (ctx.errors.length < 20) ctx.errors.push(msg);
}

function isDangerousProp(name: string): boolean {
  return name.startsWith("on") || name === "dangerouslySetInnerHTML" || name === "style" || DANGEROUS_KEYS.has(name);
}

/** 表达式编译为安全求值闭包（允许名单制；不认识的节点即报错）。 */
function compileExpr(node: unknown, ctx: Ctx): CompiledExpr | null {
  const n = node as { type: string } & Record<string, unknown>;
  switch (n.type) {
    case "Literal":
      return () => n.value as string | number | boolean | null;
    case "Identifier": {
      const name = String(n.name);
      if (DANGEROUS_KEYS.has(name)) {
        fail(ctx, `表达式包含危险标识符：${name}`);
        return null;
      }
      if (!SAFE_ROOTS.has(name)) {
        fail(ctx, `表达式包含未允许的标识符：${name}（绑定面 = data + 安全子集）`);
        return null;
      }
      return name === "data" ? (d) => d : () => globalThis[name as "Math"];
    }
    case "MemberExpression": {
      const obj = compileExpr(n.object, ctx);
      const propNode = n.property as { type: string; name?: string; value?: unknown };
      if (n.computed) {
        const key = compileExpr(propNode, ctx);
        if (!obj || !key) return null;
        return (d) => {
          const k = key(d) as string | number;
          if (typeof k !== "string" && typeof k !== "number") return undefined;
          if (DANGEROUS_KEYS.has(String(k))) return undefined;
          return (obj(d) as Record<string | number, unknown> | null | undefined)?.[k];
        };
      }
      const name = propNode.name ?? "";
      if (!name || DANGEROUS_KEYS.has(name)) {
        fail(ctx, `表达式访问了危险属性：${name || "?"}`);
        return null;
      }
      if (!obj) return null;
      return (d) => {
        const base = obj(d) as Record<string, unknown> | null | undefined;
        return base == null ? undefined : base[name];
      };
    }
    case "CallExpression": {
      const callee = n.callee as { type: string; property?: { name?: string }; name?: string };
      if (callee.type !== "MemberExpression" && callee.type !== "Identifier") {
        fail(ctx, "表达式包含不支持的调用形式");
        return null;
      }
      const fn = compileExpr(n.callee, ctx);
      const compiledArgs = (n.arguments as unknown[]).map((a) => compileExpr(a, ctx));
      if (!fn || compiledArgs.some((a) => !a)) return null;
      const args = compiledArgs as CompiledExpr[];
      // 方法名白名单（二道闸）
      if (callee.type === "MemberExpression") {
        const method = callee.property?.name ?? "";
        if (!SAFE_METHODS.has(method)) {
          fail(ctx, `调用了未允许的方法：${method}`);
          return null;
        }
      } else {
        const fname = String(callee.name ?? "");
        if (!["String", "Number", "Boolean"].includes(fname)) {
          fail(ctx, `调用了未允许的函数：${fname}`);
          return null;
        }
      }
      return (d) => {
        const f = fn(d);
        if (typeof f !== "function") return undefined;
        const callArgs = args.map((a) => a(d));
        try {
          return (f as (...a: unknown[]) => unknown).apply(undefined, callArgs);
        } catch {
          return undefined;
        }
      };
    }
    case "ArrayExpression": {
      const items = (n.elements as unknown[]).map((e) => compileExpr(e, ctx));
      if (items.some((i) => !i)) return null;
      return (d) => items.map((i) => i!(d));
    }
    case "ObjectExpression": {
      const entries: Array<[string, CompiledExpr]> = [];
      for (const prop of n.properties as Array<{ key?: { type: string; name?: string; value?: unknown }; value?: unknown; computed?: boolean }>) {
        if (prop.computed) {
          fail(ctx, "对象字面量不支持计算属性名");
          return null;
        }
        const key = prop.key?.type === "Identifier" ? prop.key.name : String(prop.key?.value ?? "");
        if (!key || isDangerousProp(key)) {
          fail(ctx, `对象字面量包含危险键：${key}`);
          return null;
        }
        const v = compileExpr(prop.value, ctx);
        if (!v) return null;
        entries.push([key, v]);
      }
      return (d) => Object.fromEntries(entries.map(([k, v]) => [k, v(d)]));
    }
    case "UnaryExpression": {
      const arg = compileExpr(n.argument, ctx);
      if (!arg) return null;
      const op = String(n.operator);
      if (!["!", "-", "+"].includes(op)) {
        fail(ctx, `不支持的一元运算符：${op}`);
        return null;
      }
      return (d) => {
        const v = arg(d) as never;
        return op === "!" ? !v : op === "-" ? -(v as number) : +(v as number);
      };
    }
    case "BinaryExpression":
    case "LogicalExpression": {
      const left = compileExpr(n.left, ctx);
      const right = compileExpr(n.right, ctx);
      if (!left || !right) return null;
      const op = String(n.operator);
      const allowed = ["==", "!=", "===", "!==", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "&&", "||"];
      if (!allowed.includes(op)) {
        fail(ctx, `不支持的运算符：${op}`);
        return null;
      }
      return (d) => {
        const l = left(d) as never;
        const r = right(d) as never;
        switch (op) {
          case "==":
            return l == r;
          case "!=":
            return l != r;
          case "===":
            return l === r;
          case "!==":
            return l !== r;
          case "<":
            return (l as number) < (r as number);
          case "<=":
            return (l as number) <= (r as number);
          case ">":
            return (l as number) > (r as number);
          case ">=":
            return (l as number) >= (r as number);
          case "+":
            return (l as number) + (r as number);
          case "-":
            return (l as number) - (r as number);
          case "*":
            return (l as number) * (r as number);
          case "/":
            return (l as number) / (r as number);
          case "%":
            return (l as number) % (r as number);
          case "&&":
            return l && r;
          default:
            return l || r;
        }
      };
    }
    case "ConditionalExpression": {
      const test = compileExpr(n.test, ctx);
      const cons = compileExpr(n.consequent, ctx);
      const alt = compileExpr(n.alternate, ctx);
      if (!test || !cons || !alt) return null;
      return (d) => (test(d) ? cons(d) : alt(d));
    }
    default:
      fail(ctx, `模板包含不支持的语法：${n.type}`);
      return null;
  }
}

/** 表达式树中是否含 JSX 元素（决定走标量绑定还是子元素通道）。 */
function containsJsx(node: unknown): boolean {
  const n = node as { type?: string; children?: unknown[] } & Record<string, unknown>;
  if (!n || typeof n !== "object") return false;
  if (n.type === "JSXElement" || n.type === "JSXFragment") return true;
  for (const key of ["expression", "test", "consequent", "alternate", "left", "right", "argument"]) {
    if (containsJsx(n[key])) return true;
  }
  for (const child of n.children ?? []) {
    if (containsJsx(child)) return true;
  }
  return false;
}

/** 子元素表达式编译：仅允许 JSX 本体、三元、&& 短路（D35 严格白名单）。 */
function compileChildExpr(node: unknown, ctx: Ctx): ((d: unknown) => TemplateNode | null) | null {
  const n = node as { type: string } & Record<string, unknown>;
  if (n.type === "JSXElement" || n.type === "JSXFragment") {
    const compiled = compileNode(node, ctx);
    return () => compiled;
  }
  if (n.type === "ParenthesizedExpression") return compileChildExpr(n.expression, ctx);
  if (n.type === "ConditionalExpression") {
    const test = compileExpr(n.test, ctx);
    const cons = compileChildExpr(n.consequent, ctx);
    const alt = compileChildExpr(n.alternate, ctx);
    if (!test || !cons || !alt) return null;
    return (d) => (test(d) ? cons(d) : alt(d));
  }
  if (n.type === "LogicalExpression" && String(n.operator) === "&&") {
    const left = compileExpr(n.left, ctx);
    const right = compileChildExpr(n.right, ctx);
    if (!left || !right) return null;
    return (d) => (left(d) ? right(d) : null);
  }
  fail(ctx, `条件渲染仅支持 三元与 && 短路（收到：${n.type}）`);
  return null;
}

function compileNode(node: unknown, ctx: Ctx): TemplateNode | null {
  const n = node as { type: string } & Record<string, unknown>;
  if (n.type === "JSXText") {
    const value = String(n.value);
    return value.trim() ? { kind: "text", value } : null;
  }
  if (n.type === "JSXExpressionContainer") {
    if (containsJsx(n.expression)) {
      // 条件/短路渲染的子元素表达式
      const render = compileChildExpr(n.expression, ctx);
      return render ? { kind: "exprChildren", render } : null;
    }
    // {expr} 标量文本插值：编译为 text 节点（渲染时字符串化）
    const expr = compileExpr(n.expression, ctx);
    if (!expr) return null;
    return { kind: "element", tag: "__expr_text", props: { value: { kind: "expr", evaluate: expr } }, children: [] };
  }
  if (n.type === "JSXElement") {
    const el = n.openingElement as {
      name: { type: string; name?: string };
      attributes: Array<{ type: string; name?: { name?: string }; value?: unknown }>;
    };
    const tag = el.name.name ?? "";
    if (el.name.type !== "JSXIdentifier" || !ctx.allowedTags.includes(tag)) {
      fail(ctx, `组件不在白名单内：<${tag || "?"}>`);
      return null;
    }
    const props: Record<string, TemplateValue> = {};
    for (const attr of el.attributes) {
      const name = attr.name?.name ?? "";
      if (isDangerousProp(name)) {
        fail(ctx, `属性被拒绝：${name}（事件处理器/dangerous 属性禁用）`);
        return null;
      }
      if (!ctx.allowedProps.includes(name)) {
        fail(ctx, `属性不在允许名单：${name}`);
        return null;
      }
      const raw = attr.value as { type?: string; value?: unknown; expression?: unknown } | null;
      let value: TemplateValue | null = null;
      if (raw == null) value = { kind: "literal", value: true };
      else if (raw.type === "Literal") value = { kind: "literal", value: raw.value as string | number | boolean };
      else if (raw.type === "JSXExpressionContainer") {
        const expr = compileExpr(raw.expression, ctx);
        if (expr) value = { kind: "expr", evaluate: expr };
      } else {
        fail(ctx, `属性 ${name} 使用了不支持的写法`);
      }
      if (!value) return null;
      if (name === "href") {
        const href = value.kind === "literal" ? String(value.value) : "";
        const okHref = href.startsWith("https://") || href.startsWith("/") || href.startsWith("#");
        if (value.kind !== "literal" || !okHref) {
          fail(ctx, `href 仅允许 https://、相对路径或 #（收到：${href || "表达式"}）`);
          return null;
        }
      }
      props[name] = value;
    }
    const children: TemplateNode[] = [];
    for (const child of n.children as unknown[]) {
      const c = compileNode(child, ctx);
      if (c) children.push(c);
    }
    return { kind: "element", tag, props, children };
  }
  if (n.type === "JSXFragment") {
    // 允许片段根：展开为透明容器
    const children: TemplateNode[] = [];
    for (const child of n.children as unknown[]) {
      const c = compileNode(child, ctx);
      if (c) children.push(c);
    }
    return { kind: "element", tag: "__fragment", props: {}, children };
  }
  fail(ctx, `模板包含不支持的节点：${n.type}`);
  return null;
}

/** 解析并校验受限 JSX 模板 → 节点树 + 错误列表（D35：失败显式报错，不白屏）。 */
export function parseJsxTemplate(src: string, options: ParseOptions): ParseResult {
  const errors: string[] = [];
  const ctx: Ctx = {
    errors,
    allowedTags: options.allowedTags,
    allowedProps: options.allowedProps ?? DEFAULT_ALLOWED_PROPS,
  };
  if (!src.trim()) return { tree: null, errors: ["模板为空"] };
  if (src.length > TEMPLATE_MAX_BYTES) return { tree: null, errors: [`模板超过 ${TEMPLATE_MAX_BYTES / 1024}KB 上限`] };

  // 二道闸：源码级拒绝名单（允许名单制已足够，纵深防御）
  for (const bad of FORBIDDEN_SOURCE) {
    if (new RegExp(`(^|[^\\w$])${bad}([^\\w$]|$)`).test(src)) {
      return { tree: null, errors: [`模板包含禁止的标识符：${bad}`] };
    }
  }

  let ast: unknown;
  try {
    ast = parser.parseExpressionAt(src, 0, { ecmaVersion: "latest", sourceType: "module" });
  } catch (e) {
    return { tree: null, errors: [`模板语法错误：${e instanceof Error ? e.message : String(e)}`] };
  }
  // 必须消费全部源码（防止尾随注入第二段表达式）
  const end = (ast as { end?: number }).end ?? 0;
  if (src.slice(end).trim()) {
    return { tree: null, errors: ["模板尾部存在多余内容（只允许单个 JSX 根）"] };
  }
  const tree = compileNode(ast, ctx);
  if (errors.length > 0) return { tree: null, errors };
  if (!tree) return { tree: null, errors: ["模板为空"] };
  return { tree, errors: [] };
}
