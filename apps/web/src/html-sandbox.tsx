/**
 * 不可信 HTML 沙箱渲染（D30/D25 工具）：deny-all iframe + CSP 禁脚本/远程图。
 * 邮件正文、RSS 摘要等第三方 HTML 一律经此渲染。
 */
export function HtmlSandbox({ html, title }: { html: string; title: string }) {
  const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-src 'none'; form-action 'none'; base-uri 'none'"></head><body>${html}</body></html>`;
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={srcDoc}
      className="wb-sandbox-frame"
    />
  );
}
