const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Bounded output capture: keeps the newest chunks up to maxBytes by
 * dropping whole chunks from the head. A single chunk larger than the
 * budget is trimmed to its UTF-8-safe tail. Counts what was discarded
 * so callers can report truncation honestly.
 */
export class OutputBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  private cachedText: string | undefined;

  totalBytes = 0;
  truncatedBytes = 0;

  constructor(private readonly maxBytes = DEFAULT_MAX_BYTES) {}

  append(chunk: string) {
    if (!chunk) return;
    this.cachedText = undefined;
    let size = Buffer.byteLength(chunk, "utf8");
    this.totalBytes += size;

    if (size > this.maxBytes) {
      const buffer = Buffer.from(chunk, "utf8");
      let tail = buffer
        .subarray(buffer.length - this.maxBytes)
        .toString("utf8");
      // A cut mid-codepoint decodes to U+FFFD at the start; drop it.
      if (tail.charCodeAt(0) === 0xfffd) tail = tail.slice(1);
      this.truncatedBytes += size - Buffer.byteLength(tail, "utf8");
      chunk = tail;
      size = Buffer.byteLength(tail, "utf8");
      this.chunks = [];
      this.bytes = 0;
    }

    this.chunks.push(chunk);
    this.bytes += size;

    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      const droppedSize = Buffer.byteLength(dropped, "utf8");
      this.bytes -= droppedSize;
      this.truncatedBytes += droppedSize;
    }
  }

  text() {
    this.cachedText ??= this.chunks.join("");
    return this.cachedText;
  }
}

/** Last maxChars of text, prefixed with a truncation marker when cut. */
export function tailText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `…[truncated]…${text.slice(text.length - maxChars)}`;
}
