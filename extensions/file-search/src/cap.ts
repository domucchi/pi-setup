export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024;

export interface CappedOutput {
  text: string;
  truncated: boolean;
  totalLines: number;
}

/**
 * Cap tool output at maxLines/maxBytes, keeping the head (search results
 * rank best-first only in the sense that early hits are as good as late
 * ones — the head is stable and cheap).
 */
export function capOutput(
  full: string,
  maxLines = MAX_OUTPUT_LINES,
  maxBytes = MAX_OUTPUT_BYTES,
): CappedOutput {
  const lines = full.split("\n");
  const totalLines = lines.length;
  let text = full;
  let truncated = false;

  if (totalLines > maxLines) {
    text = lines.slice(0, maxLines).join("\n");
    truncated = true;
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    const buffer = Buffer.from(text, "utf8").subarray(0, maxBytes);
    text = buffer.toString("utf8");
    if (text.charCodeAt(text.length - 1) === 0xfffd) text = text.slice(0, -1);
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline > 0) text = text.slice(0, lastNewline);
    truncated = true;
  }
  return { text, truncated, totalLines };
}
