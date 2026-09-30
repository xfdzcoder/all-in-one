import { useState } from "react";
import { Loader, Text } from "@mantine/core";

import { useEmbedCheck } from "./data-hooks";
import { WbAlert } from "./ui";

/**
 * iframe Widget（FR-J7：sandbox 属性 + CSP + 禁嵌明确提示）。
 * 目标站的 X-Frame-Options / frame-ancestors 拒绝嵌入时，浏览器仍会触发 iframe
 * 的 load 事件（载入错误页）——前端无法自判，由 iframe-embed connector 读响应头
 * 判定后给出明确提示与"新标签页打开"逃生口（connector/iframe.ts）。
 */
export type IframeConfig = {
  url?: string;
  /** 放开的沙箱能力（默认最小集）。 */
  sandbox?: string;
};

/** 默认沙箱：禁同源、禁顶层导航、禁表单/弹窗 —— 最小可用集。
 *  需要登录态的内网站点可配置 "allow-same-origin allow-scripts"（用户知情）。 */
const DEFAULT_SANDBOX = "allow-scripts";

export function IframeWidget({ url, sandbox }: IframeConfig) {
  const check = useEmbedCheck(url ?? "");
  const [loaded, setLoaded] = useState(false);

  if (!url) {
    return <Text size="xs" c="dimmed">配置 url 后显示嵌入页面</Text>;
  }

  // 空字符串 = 未配置（configSchema 默认值），回落最小沙箱集
  const sandboxAttr = sandbox?.trim() || DEFAULT_SANDBOX;
  const blocked = check != null && check.verified && !check.embeddable;

  return (
    <div className="wb-widget">
      <div className="wb-widget__header">
        <Text className="wb-url wb-grow" truncate>
          {url}
        </Text>
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
              <Loader size="sm" />
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
