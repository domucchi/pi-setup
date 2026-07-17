/** LF-delimited JSON parsing for stdio protocols (pure, testable). */

const MAX_LINE_BYTES = 10 * 1024 * 1024;

/**
 * Incremental line splitter: feed chunks, get complete lines. A line
 * exceeding the budget without a newline means a broken peer — the
 * parser throws so the caller can kill the process.
 */
export function createLineParser(onLine: (line: string) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    if (buffer.length > MAX_LINE_BYTES && !buffer.includes("\n")) {
      throw new Error("Protocol line exceeded 10MB without a newline.");
    }
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
    }
  };
}

/** Parse one JSON line into a record, or undefined on garbage. */
export function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
