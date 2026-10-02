import { useEffect, useRef } from "react";
import { autocompletion, closeBrackets, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { css, cssCompletionSource } from "@codemirror/lang-css";
import { HighlightStyle, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { WB_CLASSES, WB_VARS } from "./css-hints";

/**
 * 自定义 CSS 编辑器（FR-S3/Q111，**D70**）：CodeMirror 6 薄封装（对齐 D55「自写
 * useEcharts」风格，不引 react 封装层）。
 *
 * 能力：CSS 语法高亮（主题桥 `--wb-*` 令牌，深浅双主题自动跟随）+ 标准 CSS 补全
 * （`cssCompletionSource`）+ **本工作台 `--wb-*` 令牌 / `.wb-*` 语义类提示**（数据源见
 * css-hints.ts）+ 括号配对/自动闭合/撤销重做。
 */

/** 高亮着色走令牌（D39：跟随主题与 /custom.css 覆盖）。 */
const highlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--wb-color-text-muted)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.tagName, tags.angleBracket], color: "var(--wb-color-accent)" },
  { tag: [tags.propertyName], color: "var(--wb-color-info)" },
  { tag: [tags.string, tags.color, tags.number, tags.unit], color: "var(--wb-color-success)" },
  { tag: [tags.variableName], color: "var(--wb-color-warning)" },
  { tag: [tags.className, tags.labelName], color: "var(--wb-color-accent-hover)" },
]);

const theme = EditorView.theme({
  "&": {
    backgroundColor: "var(--wb-color-surface)",
    color: "var(--wb-color-text)",
    borderRadius: "var(--wb-radius-sm)",
    border: "var(--wb-border)",
    fontSize: "var(--wb-text-xs)",
  },
  "&.cm-focused": { outline: "none", borderColor: "var(--wb-color-accent)" },
  ".cm-content": { fontFamily: "var(--wb-font-mono)", padding: "var(--wb-space-2) 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--wb-color-text-muted)",
    border: "none",
    borderRight: "var(--wb-border)",
  },
  ".cm-cursor": { borderLeftColor: "var(--wb-color-text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--wb-color-surface-hover)",
  },
});

/** `--wb-*` 令牌 / `.wb-*` 类名补全（标准 CSS 补全由 cssCompletionSource 负责）。 */
function wbCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const word = ctx.matchBefore(/[\w-]+/);
  if (!ctx.explicit && !word) return null;
  const start = word ? word.from : ctx.pos;
  // 值位置（本行已有 `:`）或正在敲自定义属性名 → 给令牌；否则（选择器位置）给类名
  const inValue = before.includes(":");
  if (inValue || before.trimStart().startsWith("--")) {
    return {
      from: start,
      options: WB_VARS.map((v) => ({
        label: v,
        type: "variable",
        detail: "设计令牌",
        apply: inValue ? `var(${v})` : v,
      })),
      validFor: /^[\w-]*$/,
    };
  }
  return {
    from: start,
    options: WB_CLASSES.map((c) => ({ label: `.${c}`, type: "class", detail: "语义类", apply: `.${c}` })),
    validFor: /^[\w.-]*$/,
  };
}

export function CssEditor({
  value,
  onChange,
  minHeight = 260,
}: {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  const valueRef = useRef(value);

  // 声明序 = effect 序（D55 坑位）：先同步 ref，再挂载视图，首帧回调即拿到当前回调
  useEffect(() => {
    changeRef.current = onChange;
    valueRef.current = value;
  }, [onChange, value]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [wbCompletionSource, cssCompletionSource] }),
      css(),
      syntaxHighlighting(highlight),
      theme,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      cmPlaceholder("/* 在这里写覆盖样式（保存即生效）；--wb-* 令牌与 .wb-* 类名有提示 */"),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) changeRef.current(u.state.doc.toString());
      }),
    ];
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: valueRef.current, extensions }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 外部值变更（如回滚备份）→ 同步进编辑器；编辑器自身改动不回灌（避免光标跳动）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="wb-css-editor"
      style={{ minHeight }} /* 动态值留内联（WEB-23 口径：类承载不了的运行时值） */
    />
  );
}
