/**
 * 从图片**字节头**解析实际宽高（D60 §1 / Q89）。
 *
 * 为什么解析字节头而不是读 API 的 exif 字段：
 *  - Immich / Navidrome 两个来源的元数据字段各不相同，且 Immich `search/metadata` 不保证返回宽高；
 *  - 字节头是**渲染时真正生效的尺寸**，对任何来源通用；
 *  - 缩略图字节反正已经抓到手了（要做 data URI），顺手解析零额外请求。
 *
 * 覆盖四种容器：
 *  - **JPEG**：扫 marker 段找 SOF（Start Of Frame）段，宽高在段头后 3 字节处。
 *  - **PNG**：IHDR chunk 固定在签名之后，宽高各 4 字节大端。
 *  - **WebP**：VP8（有损）/ VP8L（无损）/ VP8X（扩展）三种 chunk 编码方式不同。
 *  - **GIF**：逻辑屏幕描述符，宽高各 2 字节小端。
 *
 * **永不 throw**：任何不识别/截断/畸形输入一律返回 `null`，由前端退化成 1:1 格子
 * （D60 §4「无宽高退化为等宽格子，不破坏整行」）。解析宽高失败绝不能让整卡失败。
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** JPEG 的 SOF 段（Start Of Frame）—— 排除 C4=DHT、C8=JPG、CC=DAC 这三个非帧定义段。 */
function isJpegSof(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function jpegSize(b: Uint8Array): ImageSize | null {
  // SOI(FF D8) 之后是若干 `FF <marker> <len:2be> <payload>` 段，SOF 一定出现在 SOS 之前。
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      i += 1; // 失步：往前找下一个 FF
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // 填充字节，继续看同一个 FF
      continue;
    }
    // 独立标记（无长度段）：TEM / RST0-7 / SOI / EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    // EOI / SOS 之后是熵编码数据 —— SOF 不可能再出现，判定为无尺寸
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 3 >= b.length) return null;
    const segLen = ((b[i + 2] as number) << 8) | (b[i + 3] as number);
    if (segLen < 2) return null; // 长度含自身 2 字节，小于 2 即畸形
    if (isJpegSof(marker)) {
      // payload: <precision:1> <height:2be> <width:2be> <components...>
      if (i + 8 >= b.length) return null;
      const height = ((b[i + 5] as number) << 8) | (b[i + 6] as number);
      const width = ((b[i + 7] as number) << 8) | (b[i + 8] as number);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + segLen;
  }
  return null;
}

function pngSize(b: Uint8Array): ImageSize | null {
  // 签名 8 字节 + <len:4be> + "IHDR" + <width:4be> + <height:4be>
  if (b.length < 24) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null; // "IHDR"
  const u32 = (o: number): number =>
    ((b[o] as number) << 24) | ((b[o + 1] as number) << 16) | ((b[o + 2] as number) << 8) | (b[o + 3] as number);
  const width = u32(16) >>> 0;
  const height = u32(20) >>> 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  // "RIFF" <size:4le> "WEBP" <fourcc:4> <chunkSize:4le> <payload>
  if (b.length < 20) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8X") {
    if (b.length < 30) return null;
    // payload: <flags:1> <reserved:3> <canvasW-1:3le> <canvasH-1:3le>
    const width = 1 + ((b[24] as number) | ((b[25] as number) << 8) | ((b[26] as number) << 16));
    const height = 1 + ((b[27] as number) | ((b[28] as number) << 8) | ((b[29] as number) << 16));
    return width > 1 && height > 1 ? { width, height } : null;
  }
  if (fourcc === "VP8L") {
    if (b.length < 25) return null;
    // payload: <0x2F 签名:1> 然后 14bit 宽-1 / 14bit 高-1 按位小端打包
    if (b[20] !== 0x2f) return null;
    const width = 1 + ((b[21] as number) | (((b[22] as number) & 0x3f) << 8));
    const height =
      1 + (((b[22] as number) >> 6) | ((b[23] as number) << 2) | (((b[24] as number) & 0x0f) << 10));
    return width > 1 && height > 1 ? { width, height } : null;
  }
  if (fourcc === "VP8 ") {
    if (b.length < 30) return null;
    // payload: <frameTag:3> <sync:3 = 9D 01 2A> <width:2le & 0x3FFF> <height:2le & 0x3FFF>
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = (((b[26] as number) | ((b[27] as number) << 8)) & 0x3fff) >>> 0;
    const height = (((b[28] as number) | ((b[29] as number) << 8)) & 0x3fff) >>> 0;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

function gifSize(b: Uint8Array): ImageSize | null {
  // "GIF87a"|"GIF89a" + <逻辑屏宽:2le> + <逻辑屏高:2le>
  if (b.length < 10) return null;
  const width = ((b[6] as number) | ((b[7] as number) << 8)) >>> 0;
  const height = ((b[8] as number) | ((b[9] as number) << 8)) >>> 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** 解析图片字节头得实际宽高；识别不了/截断/畸形一律 `null`（**不 throw**）。 */
export function imageSize(bytes: Uint8Array | undefined | null): ImageSize | null {
  if (!bytes || bytes.length < 4) return null;
  const b = bytes;
  // JPEG：FF D8
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  // PNG：89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return pngSize(b);
  }
  // WebP：RIFF....WEBP
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP") {
    return webpSize(b);
  }
  // GIF：GIF87a / GIF89a
  const head = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
  if (head === "GIF87a" || head === "GIF89a") return gifSize(b);
  return null;
}

/** QA-001（⑭）：**按字节头给真实 mime** —— data URI 不再硬编码 `image/jpeg`。
 *  Navidrome 封面常见 PNG/WebP，误标后靠浏览器嗅探侥幸显示；识别不了退回
 *  `application/octet-stream`（`<img>` 解码走内容嗅探，不受声明 mime 影响）。 */
export function imageMimeOf(bytes: Uint8Array | undefined | null): string {
  if (!bytes || bytes.length < 2) return "application/octet-stream";
  // 各格式按**各自最小魔数长度**判（不能一刀切 12 字节 —— 短 JPEG 头会被误判成 octet-stream）
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}
