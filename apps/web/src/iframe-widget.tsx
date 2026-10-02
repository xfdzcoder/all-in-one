import { useState } from "react";
import { Loader, Stack, Text } from "@mantine/core";

import { useEmbedCheck } from "./data-hooks";
import { WbAlert } from "./ui";
import { WidgetTitle } from "./widget-title";

/**
 * iframe Widget（FR-J7：sandbox 属性 + CSP + 禁嵌明确提示）。
 * 目标站的 X-Frame-Options / frame-ancestors 拒绝嵌入时，浏览器仍会触发 iframe
 * 的 load 事件（载入错误页）——前端无法自判，由 iframe-embed connector 读响应头
 * 判定后给出明确提示与"新标签页打开"逃生口（connector/iframe.ts）。
 *
 * **D67（用户反馈：「iframe 里的请求的 Origin 是 null，导致报错跨域」）**：
 * 旧默认沙箱 `allow-scripts`（不含 `allow-same-origin`）会让 iframe 文档成为
 * **不透明源**——框内页面的所有 fetch/XHR/表单请求 `Origin` 头都是字符串 `"null"`，
 * 且不带 cookie/登录态，目标站按 Origin/白名单校验即报跨域。新默认加上
 * `allow-same-origin`：框内页面拿回**它自己的正常源**（Origin = 目标站自身），
 * 登录态与同源接口随之恢复；仍禁顶层导航/表单/弹窗。
 */
export type IframeConfig = {
  url?: string;
  /** 放开的沙箱能力（默认见 DEFAULT_SANDBOX）。 */
  sandbox?: string;
};

/** 默认沙箱（D67 + **Q115 微调**）：可跑脚本 + 正常源（框内请求 Origin 正确、cookie 可用）
 *  + 可提交表单（登录/搜索类页面要用）。仍禁：顶层导航、弹窗。
 *  用户要求默认规则**直接作为输入框的值**出现在配置弹窗（不是 placeholder 提示）。 */
const DEFAULT_SANDBOX = "allow-scripts allow-same-origin allow-forms";

/** 纯函数：生效沙箱 —— 配置值优先（trim 后非空），空回落默认（D23 语义）。 */
export function resolveSandbox(custom: string | undefined): string {
  return custom?.trim() || DEFAULT_SANDBOX;
}

/** 纯函数：目标是否与工作台**同源**。
 *  同源页面配 `allow-scripts allow-same-origin` = 沙箱形同虚设（框内脚本可直接摸
 *  宿主 DOM / localStorage / 会话）——同源地址一律拒绝嵌入，见组件内拦截。 */
export function isSameOriginAsHost(url: string, hostOrigin: string): boolean {
  try {
    return new URL(url).origin === hostOrigin;
  } catch {
    return false;
  }
}

export function IframeWidget({ url, sandbox }: IframeConfig) {
  const check = useEmbedCheck(url ?? "");
  const [loaded, setLoaded] = useState(false);

  if (!url) {
    return <Text size="xs" c="dimmed">配置 url 后显示嵌入页面</Text>;
  }

  const sandboxAttr = resolveSandbox(sandbox);
  const sameOrigin = isSameOriginAsHost(url, window.location.origin);
  const blocked = check != null && check.verified && !check.embeddable;

  // D67：同源自嵌 = 解除沙箱，直接拒绝（不加载 iframe）
  if (sameOrigin) {
    return (
      <div className="wb-widget">
        <div className="wb-widget__header">
          <Text className="wb-url wb-grow" truncate>
            {url}
          </Text>
        </div>
        <div className="wb-widget__body">
          <WbAlert tone="warning">
            <strong>不能嵌入工作台自身的地址</strong>
            <br />
            该地址与工作台同源，嵌入会绕过沙箱隔离（框内脚本可读写工作台数据）。
            请
            <a href={url} target="_blank" rel="noopener noreferrer"> 在新标签页打开</a>
            ，或改用其它地址。
          </WbAlert>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-widget">
      <div className="wb-widget__header">
        {/* 用户要求：标题（URL）可点击、新标签页打开 —— 复用 D59 标题链接形态 */}
        <WidgetTitle title={url} href={url} className="wb-url" tip={url} />
      </div>
      {blocked && (
        <WbAlert tone="warning">
          <strong>无法嵌入此页面</strong>
          <br />
          目标站点禁止被嵌入（{check.reason}）。请
          <a href={url} target="_blank" rel="noopener noreferrer"> 在新标签页打开</a>
          ，或在目标服务的设置中允许嵌入当前地址。
        </WbAlert>
      )}
      <div className="wb-widget__body">
        <div className="wb-frame">
          {!loaded && !blocked && (
            <div className="wb-frame__loader">
              <Stack gap="xs" align="center">
                <Loader size="sm" />
                <Text size="xs" c="dimmed" className="wb-loading">
                  加载中…
                </Text>
              </Stack>
            </div>
          )}
          <iframe
            src={url}
            sandbox={sandboxAttr}
            title="embedded-page"
            className={blocked ? "wb-frame__el--hidden" : undefined}
            onLoad={() => setLoaded(true)}
          />
        </div>
      </div>
    </div>
  );
}
