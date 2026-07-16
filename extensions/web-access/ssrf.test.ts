import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp, SsrfError } from "./src/ssrf.ts";

describe("isPrivateIp", () => {
  it("flags loopback, link-local, private, and CGNAT v4", () => {
    for (const ip of [
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public v4", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("flags loopback/link-local/ULA v6 and v4-mapped", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false); // public
  });
});

describe("assertPublicUrl", () => {
  const publicLookup = async () => [{ address: "93.184.216.34" }];

  it("rejects literal private IPs without DNS", async () => {
    await expect(
      assertPublicUrl(new URL("http://169.254.169.254/"), async () => {
        throw new Error("should not resolve");
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects localhost hostnames", async () => {
    await expect(assertPublicUrl(new URL("http://localhost:3000/"), publicLookup)).rejects.toThrow(
      /internal host/,
    );
  });

  it("rejects public hostnames that resolve to private IPs", async () => {
    await expect(
      assertPublicUrl(new URL("http://rebind.example.com/"), async () => [
        { address: "192.168.1.10" },
      ]),
    ).rejects.toThrow(/private address/);
  });

  it("allows public hostnames that resolve to public IPs", async () => {
    await expect(
      assertPublicUrl(new URL("https://example.com/"), publicLookup),
    ).resolves.toBeUndefined();
  });

  it("rejects unresolvable hosts", async () => {
    await expect(
      assertPublicUrl(new URL("http://nope.invalid/"), async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/resolve/);
  });
});
