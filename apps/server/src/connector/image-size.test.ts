import { describe, expect, it } from "vitest";
import { imageSize } from "./image-size.ts";

/** 拼一段字节。 */
function bytes(...parts: Array<number | number[] | Uint8Array>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "number") out.push(p);
    else out.push(...p);
  }
  return new Uint8Array(out);
}

/** SOF0 段：`FF C0 <len:2be> <precision> <h:2be> <w:2be> <ncomp> <ncomp×3>`。 */
function sof0(w: number, h: number): number[] {
  return [
    0xff,
    0xc0,
    0x00,
    0x11, // 段长 17
    0x08, // 精度
    (h >> 8) & 0xff,
    h & 0xff,
    (w >> 8) & 0xff,
    w & 0xff,
    0x03, // 3 个分量
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
  ];
}

describe("imageSize（D60 §1 字节头解析宽高，Q89）", () => {
  it("JPEG：扫过 APPn 段后从 SOF0 读宽高", () => {
    const jpg = bytes(
      [0xff, 0xd8], // SOI
      [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], // APP0，段长 4（须被正确跳过）
      sof0(600, 300),
    );
    expect(imageSize(jpg)).toEqual({ width: 600, height: 300 });
  });

  it("JPEG：SOF2（渐进式）同样识别；DHT(C4)/JPG(C8)/DAC(CC) 不是帧段不误判", () => {
    const progressive = bytes([0xff, 0xd8], [0xff, 0xc2, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03], sof0(1, 1));
    expect(imageSize(progressive)).toEqual({ width: 600, height: 300 });

    // 先出现三个「长得像 SOF」的非帧段，若误判会读出垃圾
    const decoys = bytes(
      [0xff, 0xd8],
      [0xff, 0xc4, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00],
      [0xff, 0xc8, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00],
      [0xff, 0xcc, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00],
      sof0(64, 48),
    );
    expect(imageSize(decoys)).toEqual({ width: 64, height: 48 });
  });

  it("JPEG：无 SOF（直接 SOS/EOI）→ null，不 throw", () => {
    expect(imageSize(bytes([0xff, 0xd8], [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]))).toBe(null);
    expect(imageSize(bytes([0xff, 0xd8], [0xff, 0xd9]))).toBe(null);
    // SOF 被截断在宽度之前
    expect(imageSize(bytes([0xff, 0xd8], [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c]))).toBe(null);
  });

  it("JPEG：宽或高为 0 判畸形 → null", () => {
    expect(imageSize(bytes([0xff, 0xd8], sof0(0, 300)))).toBe(null);
    expect(imageSize(bytes([0xff, 0xd8], sof0(600, 0)))).toBe(null);
    // 段长 < 2 畸形
    expect(imageSize(bytes([0xff, 0xd8], [0xff, 0xc0, 0x00, 0x00]))).toBe(null);
  });

  it("PNG：IHDR 读 4 字节大端宽高", () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // 签名
      [0x00, 0x00, 0x00, 0x0d], // IHDR 长度 13
      [0x49, 0x48, 0x44, 0x52], // "IHDR"
      [0x00, 0x00, 0x02, 0x80], // 宽 640
      [0x00, 0x00, 0x01, 0xe0], // 高 480
      [0x08, 0x02, 0x00, 0x00, 0x00],
    );
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
  });

  it("PNG：签名对但首块不是 IHDR → null", () => {
    const bad = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0], "IDAT".split("").map((c) => c.charCodeAt(0)), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(bad)).toBe(null);
    expect(imageSize(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(null); // 截断
  });

  it("WebP VP8X（扩展）：画布尺寸 3 字节小端，存的是「减 1」", () => {
    const webp = bytes(
      "RIFF".split("").map((c) => c.charCodeAt(0)),
      [0x00, 0x00, 0x00, 0x00],
      "WEBP".split("").map((c) => c.charCodeAt(0)),
      "VP8X".split("").map((c) => c.charCodeAt(0)),
      [0x0a, 0x00, 0x00, 0x00],
      [0x10], // flags
      [0x00, 0x00, 0x00], // reserved
      [0x3f, 0x01, 0x00], // 宽-1 = 319 → 320
      [0xb3, 0x00, 0x00], // 高-1 = 179 → 180
    );
    expect(imageSize(webp)).toEqual({ width: 320, height: 180 });
  });

  it("WebP VP8L（无损）：14bit 按位小端打包", () => {
    const webp = bytes(
      "RIFF".split("").map((c) => c.charCodeAt(0)),
      [0x00, 0x00, 0x00, 0x00],
      "WEBP".split("").map((c) => c.charCodeAt(0)),
      "VP8L".split("").map((c) => c.charCodeAt(0)),
      [0x05, 0x00, 0x00, 0x00],
      [0x2f], // 无损签名
      [0xff, 0xc1, 0x3f, 0x00], // 512 × 256
      [0x00],
    );
    expect(imageSize(webp)).toEqual({ width: 512, height: 256 });
  });

  it("WebP VP8（有损）：同步码 9D 01 2A 之后 2 字节小端 14bit", () => {
    const webp = bytes(
      "RIFF".split("").map((c) => c.charCodeAt(0)),
      [0x00, 0x00, 0x00, 0x00],
      "WEBP".split("").map((c) => c.charCodeAt(0)),
      "VP8 ".split("").map((c) => c.charCodeAt(0)),
      [0x0c, 0x00, 0x00, 0x00],
      [0x00, 0x00, 0x00], // frame tag
      [0x9d, 0x01, 0x2a], // 同步码
      [0xc8, 0x00], // 宽 200
      [0x96, 0x00], // 高 150
    );
    expect(imageSize(webp)).toEqual({ width: 200, height: 150 });

    // 同步码不对 = 不是有损 VP8 流
    const broken = bytes(webp);
    broken[23] = 0x00;
    expect(imageSize(broken)).toBe(null);
  });

  it("GIF：逻辑屏幕宽高 2 字节小端", () => {
    const gif = bytes(
      "GIF89a".split("").map((c) => c.charCodeAt(0)),
      [0x00, 0x04], // 1024
      [0x00, 0x03], // 768
      [0x00, 0x00],
    );
    expect(imageSize(gif)).toEqual({ width: 1024, height: 768 });
  });

  it("不认识的/空的/截断的一律 null，**绝不 throw**", () => {
    expect(imageSize(undefined)).toBe(null);
    expect(imageSize(null)).toBe(null);
    expect(imageSize(new Uint8Array(0))).toBe(null);
    expect(imageSize(new Uint8Array([1, 2]))).toBe(null);
    expect(imageSize(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 0]))).toBe(null); // 未知容器
    expect(imageSize(bytes("RIFF".split("").map((c) => c.charCodeAt(0)), [0, 0, 0, 0], "WEBP".split("").map((c) => c.charCodeAt(0)), "VP8X".split("").map((c) => c.charCodeAt(0))))).toBe(null); // WebP 头被截断
  });
});
