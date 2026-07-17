import { describe, expect, it } from "vitest";
import { parseV6Groups } from "../shared/ip.ts";
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

  it("flags HEX-form IPv4-mapped v6 (Node's canonicalization)", () => {
    // Regression: http://[::ffff:127.0.0.1]/ canonicalizes to the hex
    // form, which the old dotted-only regex let through.
    for (const ip of [
      "::ffff:7f00:1", // 127.0.0.1
      "::ffff:a9fe:a9fe", // 169.254.169.254 (metadata)
      "::ffff:c0a8:101", // 192.168.1.1
      "::7f00:1", // deprecated IPv4-compatible 127.0.0.1
      "64:ff9b::7f00:1", // NAT64 to loopback
      "64:ff9b::a9fe:a9fe", // NAT64 to metadata
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp("::ffff:808:808")).toBe(false); // 8.8.8.8
    expect(isPrivateIp("64:ff9b::101:101")).toBe(false); // NAT64 to 1.1.1.1
  });

  it("parses groups and rejects malformed v6", () => {
    expect(parseV6Groups("::ffff:7f00:1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseV6Groups("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    for (const ip of ["::ffff:zz00:1", "1::2::3", "1:2:3:4:5:6:7:8:9", "::300.0.0.1"]) {
      expect(parseV6Groups(ip), ip).toBeUndefined();
    }
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
