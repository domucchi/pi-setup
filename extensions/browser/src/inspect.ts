/** Pure formatting for the console/network inspection tools (testable). */

import type { ConsoleEntry, RequestEntry } from "./session.ts";

const CONSOLE_TEXT_CHARS = 400;

/** Tail of the console log, oldest first within the window. */
export function formatConsoleEntries(
  entries: ConsoleEntry[],
  limit: number,
): string {
  if (entries.length === 0) return "(no console output)";
  const shown = entries.slice(-limit);
  const lines = shown.map(
    (entry) => `[${entry.level}] ${entry.text.slice(0, CONSOLE_TEXT_CHARS)}`,
  );
  if (entries.length > shown.length) {
    lines.unshift(`(showing last ${shown.length} of ${entries.length} entries)`);
  }
  return lines.join("\n");
}

/** Tail of the network log, optionally filtered by URL substring. */
export function formatRequestEntries(
  entries: RequestEntry[],
  limit: number,
  filter?: string,
): string {
  const matching = filter
    ? entries.filter((e) => e.url.includes(filter))
    : entries;
  if (matching.length === 0) {
    return filter
      ? `(no requests matching "${filter}")`
      : "(no requests recorded)";
  }
  const shown = matching.slice(-limit);
  const lines = shown.map((entry) =>
    entry.failure !== undefined
      ? `FAIL ${entry.method} ${entry.url} — ${entry.failure} (${entry.resourceType})`
      : `${entry.status} ${entry.method} ${entry.url} (${entry.resourceType})`,
  );
  if (matching.length > shown.length) {
    lines.unshift(
      `(showing last ${shown.length} of ${matching.length} matching requests)`,
    );
  }
  return lines.join("\n");
}

/** Stringify an evaluate() result within a budget. */
export function formatEvaluateResult(value: unknown, maxChars = 10_000): string {
  let text: string;
  try {
    text = value === undefined ? "undefined" : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}\n…[result clipped at ${maxChars} of ${text.length} chars]`;
  }
  return text;
}
