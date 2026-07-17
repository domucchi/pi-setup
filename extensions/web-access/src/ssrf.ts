import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

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

/**
 * Parse an IPv6 address into its 8 16-bit groups (dotted-v4 tails are
 * folded into the last two groups first). Returns undefined on
 * malformed input — callers must refuse those.
 */
export function parseV6Groups(ip: string): number[] | undefined {
  let addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (addr.includes("%")) addr = addr.slice(0, addr.indexOf("%")); // zone id
  const v4 = addr.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return undefined;
    const hex =
      `${(((octets[0] << 8) | octets[1]) >>> 0).toString(16)}:` +
      `${(((octets[2] << 8) | octets[3]) >>> 0).toString(16)}`;
    addr = addr.slice(0, addr.length - v4[0].length) + hex;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 0 : head.length !== 8) return undefined;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) {
    return undefined;
  }
  return groups;
}

function embeddedV4(groups: number[]): string {
  const [g6, g7] = [groups[6], groups[7]];
  return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
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
  // IPv4-mapped ::ffff:0:0/96 and deprecated IPv4-compatible ::/96.
  if (leadingZeros && (groups[5] === 0xffff || groups[5] === 0)) {
    return isPrivateV4(embeddedV4(groups));
  }
  // NAT64 64:ff9b::/96.
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((g) => g === 0)
  ) {
    return isPrivateV4(embeddedV4(groups));
  }
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
