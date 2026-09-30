import { describe, expect, it } from "vitest";

import { parseJsxTemplate, TEMPLATE_MAX_BYTES } from "./index.ts";

const TAGS = ["Stack", "Group", "Text", "Title", "Badge", "Card", "Progress", "Anchor"] as const;

const parse = (src: string) => parseJsxTemplate(src, { allowedTags: TAGS });

describe("restricted JSX template (D35: 模板是数据不是代码)", () => {
  it("parses a normal template with bindings and safe helpers", () => {
    const src = `
      <Stack>
        <Title order={4}>{data.title}</Title>
        <Text size="sm">{String(data.name).toUpperCase()} · {Math.round(data.cpu)}%</Text>
        {data.ok ? <Badge>OK</Badge> : <Badge>DOWN</Badge>}
        <Progress value={data.cpu} label="CPU" />
        <Anchor href="https://example.com/x">文档</Anchor>
      </Stack>`;
    const r = parse(src);
    expect(r.errors).toEqual([]);
    expect(r.tree?.kind).toBe("element");
  });

  it("evaluates bindings against data (member/call/ternary/logic)", () => {
    const r = parse(`<Text>{data.items[0].name + "!"}</Text>`);
    expect(r.errors).toEqual([]);
    const tree = r.tree as { children: Array<{ props: { value: { evaluate: (d: unknown) => unknown } } }> };
    const text = tree.children[0].props.value.evaluate({
      items: [{ name: "api-ok" }],
    });
    expect(text).toBe("api-ok!");
  });

  it("rejects forbidden identifiers (defense in depth)", () => {
    for (const bad of ["eval('x')", "Function('x')", "window.location", "document.title", "fetch('/x')", "globalThis", "require('x')", "import('x')"]) {
      const r = parse(`<Text>{${bad}}</Text>`);
      expect(r.errors.length).toBeGreaterThan(0, bad);
    }
  });

  it("rejects escape attempts via data properties", () => {
    for (const bad of ["data.constructor", "data.a.constructor", "data.__proto__", "data.x.bind"]) {
      const r = parse(`<Text>{${bad}}</Text>`);
      expect(r.errors.length).toBeGreaterThan(0, bad);
    }
  });

  it("rejects event handlers, dangerous props/tags, and unknown props", () => {
    expect(parse(`<Text onClick="x">a</Text>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Text dangerouslySetInnerHTML={{__html: "x"}}>a</Text>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<script>a</script>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<iframe src="https://x" />`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Text style={{color: "red"}}>a</Text>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Text unknownProp="1">a</Text>`).errors.length).toBeGreaterThan(0);
  });

  it("validates href allowlist (https / relative / # only)", () => {
    expect(parse(`<Anchor href="https://ok.example">x</Anchor>`).errors).toEqual([]);
    expect(parse(`<Anchor href="/local/path">x</Anchor>`).errors).toEqual([]);
    expect(parse(`<Anchor href="#top">x</Anchor>`).errors).toEqual([]);
    expect(parse(`<Anchor href="javascript:alert(1)">x</Anchor>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Anchor href="http://plain.example">x</Anchor>`).errors.length).toBeGreaterThan(0);
  });

  it("rejects unknown tags and unsupported syntax", () => {
    expect(parse(`<Evil>x</Evil>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Text>{await x()}</Text>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Text>{data.a}</Text>; <Text>trailing</Text>`).errors.length).toBeGreaterThan(0);
    expect(parse(`not jsx at all`).errors.length).toBeGreaterThan(0);
  });

  it("rejects non-whitelisted method calls but allows safe helpers", () => {
    expect(parse(`<Text>{Math.round(1.2)}</Text>`).errors).toEqual([]);
    expect(parse(`<Text>{JSON.stringify(data)}</Text>`).errors).toEqual([]);
    expect(parse(`<Text>{data.forEach(() => 1)}</Text>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Text>{data.map((x) => x)}</Text>`).errors.length).toBeGreaterThan(0);
    expect(parse(`<Text>{String.fromCharCode(65)}</Text>`).errors.length).toBeGreaterThan(0);
  });

  it("enforces the size cap", () => {
    const big = `<Text>{"${"x".repeat(TEMPLATE_MAX_BYTES)}"}</Text>`;
    const r = parseJsxTemplate(big, { allowedTags: TAGS });
    expect(r.errors.some((e) => e.includes("上限"))).toBe(true);
  });
});
