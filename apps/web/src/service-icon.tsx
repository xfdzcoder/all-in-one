import glancesSvg from "./icons/brand/glances.svg?raw";
import immichSvg from "./icons/brand/immich.svg?raw";
import navidromeSvg from "./icons/brand/navidrome.svg?raw";
import gmailSvg from "./icons/brand/gmail.svg?raw";
import opencodeSvg from "./icons/brand/opencode.svg?raw";
import rssSvg from "./icons/brand/rss.svg?raw";
import portainerSvg from "./icons/brand/portainer.svg?raw";
// PNG 品牌标走构建资产 URL（mihomo 家族 logo）
import mihomoPng from "./icons/brand/mihomo.png";

/**
 * 服务官方图标（Q38/三.1）：已接入服务用**官方品牌图标**，不自绘。
 * 图标为 vendored SVG（来源与许可见 icons/brand/SOURCES.md；简单图标 CC0，
 * dashboard-icons 集合 MIT + 商标归各自所有者），零外呼、随包分发。
 * 未登记的服务名回落 null（调用方给通用图标）；URL 值走 <img>（自定义图标库 Q38b）。
 */
const BRAND: Record<string, string> = {
  glances: glancesSvg,
  opencode: opencodeSvg,
  gmail: gmailSvg,
  rss: rssSvg,
  immich: immichSvg,
  navidrome: navidromeSvg,
  portainer: portainerSvg,
};

/** PNG 品牌标（构建资产 URL）。 */
const BRAND_URL: Record<string, string> = {
  mihomo: mihomoPng,
  metacubexd: mihomoPng,
};

export const SERVICE_ICON_NAMES = Object.keys(BRAND);

export function ServiceIcon({ name, size = 18 }: { name?: string; size?: number }) {
  if (!name) return null;
  if (/^(https?:|data:|\/)/.test(name)) { // 含根路径引用（/api/icons/:id，Q38b）
    return <img className="wb-service-icon" src={name} alt="" width={size} height={size} />;
  }
  if (BRAND_URL[name]) {
    return <img className="wb-service-icon" src={BRAND_URL[name]} alt="" width={size} height={size} />;
  }
  // Q38b：自定义图标库引用（custom:<id> → 服务端文件）
  if (name.startsWith("custom:")) {
    return <img className="wb-service-icon" src={`/api/icons/${name.slice("custom:".length)}`} alt="" width={size} height={size} />;
  }
  const svg = BRAND[name];
  if (!svg) return null;
  return (
    <span
      className="wb-service-icon"
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
