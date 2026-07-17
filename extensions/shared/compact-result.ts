/**
 * Compact tool-result rendering: our search/web tools return output that
 * matters to the model but rarely to the human, so collapsed view shows a
 * dim one-liner (plus a short preview) instead of the whole block.
 * ctrl+o (app.tools.expand) still reveals the full output — rendering
 * only changes what the human sees, never what the model receives.
 */

import { Text, type Component } from "@earendil-works/pi-tui";
import type { OverlayTheme } from "./overlay.ts";

const PREVIEW_LINE_CHARS = 160;

export function renderCompactResult(options: {
  theme: OverlayTheme;
  expanded: boolean;
  /** One-line collapsed summary, e.g. "→ 42 files". */
  summary: string;
  /** Full tool output, shown when the user expands tool output. */
  fullText: string;
  /** A few dim lines under the collapsed summary (already selected). */
  previewLines?: string[];
  /** Render everything in the error style and never collapse. */
  isError?: boolean;
}): Component {
  const { theme } = options;
  if (options.isError) {
    return new Text(theme.fg("error", options.fullText || options.summary), 0, 0);
  }
  if (options.expanded) {
    return new Text(theme.fg("toolOutput", options.fullText), 0, 0);
  }
  let text = theme.fg("dim", options.summary);
  for (const line of options.previewLines ?? []) {
    text += `\n${theme.fg("dim", `  ${line.slice(0, PREVIEW_LINE_CHARS)}`)}`;
  }
  return new Text(text, 0, 0);
}

/** First text block of a tool result. */
export function resultText(result: { content: { type: string; text?: string }[] }): string {
  const first = result.content.find((c) => c.type === "text");
  return first?.text ?? "";
}

/** First N non-empty lines of a body, optionally skipping a header line. */
export function previewOf(text: string, lines: number, skip = 0): string[] {
  return text
    .split("\n")
    .slice(skip)
    .filter((line) => line.trim() !== "")
    .slice(0, lines);
}
