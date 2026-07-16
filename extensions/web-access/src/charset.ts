/** Charset from a content-type header, e.g. "text/html; charset=iso-8859-1". */
export function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset\s*=\s*"?([\w-]+)"?/i);
  return match ? match[1].toLowerCase() : null;
}

/** Sniff a charset from an HTML <meta> tag in the first bytes of a page. */
export function charsetFromHtml(head: string): string | null {
  const metaCharset = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i);
  if (metaCharset) return metaCharset[1].toLowerCase();
  const httpEquiv = head.match(
    /<meta[^>]+http-equiv\s*=\s*["']?content-type["'][^>]*content\s*=\s*["'][^"']*charset=([\w-]+)/i,
  );
  return httpEquiv ? httpEquiv[1].toLowerCase() : null;
}

/**
 * Decode bytes using the declared charset (header first, then an HTML
 * meta sniff), defaulting to UTF-8. Unknown labels fall back to UTF-8
 * rather than throwing.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  let charset = charsetFromContentType(contentType);
  if (!charset) {
    // Sniff the first 2KB as latin1 (byte-preserving) to find a meta tag.
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    charset = charsetFromHtml(head);
  }
  const label = charset ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
