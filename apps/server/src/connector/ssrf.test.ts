import { describe, expect, it } from "vitest";

import { assertSafeOutboundUrl, SsrfBlockedError } from "./ssrf.ts";

const publicDns = async () => [{ address: "93.184.216.34" }];
const privateDns = async () => [{ address: "192.168.31.133" }];
const mixedDns = async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }];

describe("SSRF baseline (SEC4)", () => {
  it("allows public https URLs", async () => {
    const url = await assertSafeOutboundUrl("https://example.com/api", false, publicDns);
    expect(url.hostname).toBe("example.com");
  });

  it("blocks non-http protocols", async () => {
    await expect(assertSafeOutboundUrl("ftp://example.com")).rejects.toThrow(SsrfBlockedError);
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks private IP literals (LAN / loopback / metadata)", async () => {
    for (const u of [
      "http://192.168.31.133/admin",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://127.0.0.1:3000/",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://[::1]/",
    ]) {
      await expect(assertSafeOutboundUrl(u)).rejects.toThrow(SsrfBlockedError);
    }
  });

  it("blocks localhost hostname", async () => {
    await expect(assertSafeOutboundUrl("http://localhost:3000/")).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks domains resolving to private IPs (DNS rebinding)", async () => {
    await expect(assertSafeOutboundUrl("http://evil.example.com/", false, privateDns)).rejects.toThrow(
      /private IP/,
    );
  });

  it("blocks if ANY resolved address is private (mixed records)", async () => {
    await expect(
      assertSafeOutboundUrl("http://mixed.example.com/", false, mixedDns),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks on DNS failure or empty records", async () => {
    await expect(
      assertSafeOutboundUrl("http://nxdomain.example.com/", false, async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/DNS/);
    await expect(
      assertSafeOutboundUrl("http://empty.example.com/", false, async () => []),
    ).rejects.toThrow(/no DNS/);
  });

  it("allowPrivate opt-out works (tests / future user whitelist)", async () => {
    const url = await assertSafeOutboundUrl("http://192.168.31.133/", true);
    expect(url.hostname).toBe("192.168.31.133");
  });
});

// Q97a（体检 SRV-01 + SEC-1）：内网判定补严 —— IPv4-mapped 十六进制形态曾整体漏判
describe("内网判定补严（SRV-01 / SEC-1）", () => {
  it("blocks IPv4-mapped IPv6 in hex-group form (SRV-01 bypass closed)", async () => {
    for (const u of [
      "http://[::ffff:7f00:1]/", // 127.0.0.1
      "http://[::ffff:c0a8:1f85]/", // 192.168.31.133
      "http://[::ffff:a00:5]/", // 10.0.0.5
      "http://[::ffff:a9fe:a9fe]/", // 169.254.169.254（云元数据）
    ]) {
      await expect(assertSafeOutboundUrl(u), u).rejects.toThrow(SsrfBlockedError);
    }
  });

  it("blocks IPv4-mapped / IPv4-compatible dotted forms", async () => {
    for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::127.0.0.1]/", "http://[::ffff:192.168.1.1]/"]) {
      await expect(assertSafeOutboundUrl(u), u).rejects.toThrow(SsrfBlockedError);
    }
  });

  it("allows public IPv4-mapped IPv6 (8.8.8.8)", async () => {
    await expect(assertSafeOutboundUrl("http://[::ffff:808:808]/")).resolves.toBeTruthy();
    await expect(assertSafeOutboundUrl("http://[::ffff:8.8.8.8]/")).resolves.toBeTruthy();
  });

  it("blocks link-local beyond the fe80 prefix (fe80::/10, SEC-1)", async () => {
    for (const u of ["http://[fe80::1]/", "http://[fe81::1]/", "http://[febf:ffff::1]/"]) {
      await expect(assertSafeOutboundUrl(u), u).rejects.toThrow(SsrfBlockedError);
    }
  });

  it("blocks multicast / ULA / doc ranges and IPv4 special ranges (SEC-1)", async () => {
    for (const u of [
      "http://[ff02::1]/", // multicast
      "http://[fd12:3456::1]/", // ULA
      "http://[2001:db8::1]/", // 文档段
      "http://100.64.0.1/", // CGNAT 100.64/10
      "http://198.18.0.1/", // benchmark 198.18/15
      "http://203.0.113.7/", // TEST-NET-3
      "http://192.0.2.1/", // TEST-NET-1
    ]) {
      await expect(assertSafeOutboundUrl(u), u).rejects.toThrow(SsrfBlockedError);
    }
  });

  it("DNS resolving to an IPv4-mapped private form is blocked too", async () => {
    await expect(
      assertSafeOutboundUrl("https://evil.example/", false, async () => [{ address: "::ffff:7f00:1" }]),
    ).rejects.toThrow(SsrfBlockedError);
  });
});
