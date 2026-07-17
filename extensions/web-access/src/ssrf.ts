import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { mappedV4, parseV6Groups } from "../../shared/ip.ts";

/** DNS resolver, injectable for tests. Returns resolved IP addresses. */
export type Lookup = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: Lookup = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

/**
 * True for IPs that must never be fetched: loopback, link-local
 * (incl. cloud metadata 169.254.169.254), private, unique-local, and
 * unspecified. Handles IPv4, IPv6, and IPv4-mapped IPv6.
 */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return false;
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → refuse
  }
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 255 && b === 255) return true; // broadcast
  return false;
}

function isPrivateV6(ip: string): boolean {
  // Node canonicalizes IPv4-mapped addresses to HEX groups
  // (::ffff:127.0.0.1 → ::ffff:7f00:1), so string prefixes are not
  // enough — decide on the parsed groups.
  const groups = parseV6Groups(ip);
  if (!groups) return true; // malformed → refuse
  const leadingZeros = groups.slice(0, 5).every((g) => g === 0);
  // Unspecified (::) and loopback (::1).
  if (leadingZeros && groups[5] === 0 && groups[6] === 0) {
    return true;
  }
  // IPv4-mapped / IPv4-compatible / NAT64 → judge the embedded v4.
  const embedded = mappedV4(groups);
  if (embedded) return isPrivateV4(embedded);
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  return false;
}

const BLOCKED_HOSTNAMES = /^(localhost|.*\.localhost)$/i;

/**
 * Throw when a URL points at a non-public host. Resolves hostnames via
 * DNS and rejects if any resolved address is private, so a public domain
 * that points at an internal IP is caught too. Note: a determined
 * attacker could still DNS-rebind between this check and the fetch; full
 * protection requires IP pinning, which we intentionally skip for a
 * single-user personal harness.
 */
export async function assertPublicUrl(
  url: URL,
  lookup: Lookup = defaultLookup,
): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.test(host)) {
    throw new SsrfError(`Refusing to fetch internal host "${host}".`);
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new SsrfError(`Refusing to fetch private/loopback address "${host}".`);
    }
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new SsrfError(`Could not resolve host "${host}".`);
  }
  if (addresses.length === 0) {
    throw new SsrfError(`Host "${host}" did not resolve.`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new SsrfError(
        `Refusing to fetch "${host}": it resolves to a private address.`,
      );
    }
  }
}

export class SsrfError extends Error {}
