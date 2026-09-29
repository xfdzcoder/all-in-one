import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Group, Text } from "@mantine/core";

/**
 * iframe Widget（FR-J7：sandbox 属性 + CSP + 禁嵌明确提示）。
 * 目标站的 X-Frame-Options / frame-ancestors 禁止嵌入时浏览器会呈现
 * 空白 frame —— 检测 onLoad 未到达 / 空白内容给出明确提示（01 §2.3）。
 */
export type IframeConfig = {
  url?: string;
  /** 放开的沙箱能力（默认最小集）。 */
  sandbox?: string;
  /** 加载超时提示阈值（秒）。 */
  timeoutSec?: number;
};

/** 默认沙箱：禁同源、禁顶层导航、禁表单/弹窗 —— 最小可用集。
 *  需要登录态的内网站点可配置 "allow-same-origin allow-scripts"（用户知情）。 */
const DEFAULT_SANDBOX = "allow-scripts";

export function IframeWidget({ url, sandbox, timeoutSec = 8 }: IframeConfig) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // url 变更时重置加载状态（render 期间派生调整，非 effect）
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    setLoaded(false);
    setTimedOut(false);
  }

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), timeoutSec * 1000);
    return () => clearTimeout(t);
  }, [url, timeoutSec]);

  if (!url) {
    return <Text size="xs" c="dimmed">配置 url 后显示嵌入页面</Text>;
  }

  const blocked = timedOut && !loaded;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Group gap={6} mb={4}>
        <Badge size="xs" variant="light" style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
          {url}
        </Badge>
      </Group>
      {blocked && (
        <Alert color="yellow" title="无法嵌入此页面">
          目标站点禁止被嵌入（X-Frame-Options / CSP frame-ancestors）。请
          <a href={url} target="_blank" rel="noopener noreferrer"> 在新标签页打开</a>
          ，或在目标服务的设置中允许嵌入当前地址。
        </Alert>
      )}
      <iframe
        ref={ref}
        src={url}
        sandbox={sandbox ?? DEFAULT_SANDBOX}
        title="embedded-page"
        style={{
          flex: 1,
          width: "100%",
          border: 0,
          borderRadius: 6,
          background: "#fff",
          display: blocked ? "none" : "block",
        }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
