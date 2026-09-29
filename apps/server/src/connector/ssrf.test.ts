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
