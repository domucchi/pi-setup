/** Low-level IP address parsing shared across features (pure, tested). */

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

/** The dotted IPv4 embedded in the last two groups of a mapped address. */
export function embeddedV4(groups: number[]): string {
  const [g6, g7] = [groups[6], groups[7]];
  return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
}

/**
 * When groups embed an IPv4 address (IPv4-mapped ::ffff:0:0/96,
 * deprecated IPv4-compatible ::/96, or NAT64 64:ff9b::/96), return its
 * dotted form; otherwise undefined.
 */
export function mappedV4(groups: number[]): string | undefined {
  const leadingZeros = groups.slice(0, 5).every((g) => g === 0);
  if (leadingZeros && (groups[5] === 0xffff || groups[5] === 0)) {
    return embeddedV4(groups);
  }
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((g) => g === 0)
  ) {
    return embeddedV4(groups);
  }
  return undefined;
}
