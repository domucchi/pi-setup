/** Pure logic for the live working-line (what the agent is doing now). */

import { formatDuration, formatTokens } from "../../shared/agent-format.ts";

/** Args fields worth showing, in preference order (first string wins). */
const PREVIEW_KEYS = [
  "command",
  "path",
  "file_path",
  "pattern",
  "url",
  "query",
  "element",
  "expression",
  "title",
  "name",
  "id",
];

const LABEL_MAX_CHARS = 56;

/** "Edit manager.ts" / "bash npm test" / bare tool name when args are dull. */
export function toolActivityLabel(toolName: string, args: unknown): string {
  const record =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : undefined;
  let preview: string | undefined;
  if (record) {
    for (const key of PREVIEW_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        preview = value.trim().split("\n")[0];
        break;
      }
    }
  }
  const label = preview ? `${toolName} ${preview}` : toolName;
  return label.length > LABEL_MAX_CHARS
    ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…`
    : label;
}

/** Map a streaming-event type to a phase label (undefined = keep current). */
export function phaseLabel(eventType: string): string | undefined {
  if (eventType.startsWith("thinking")) return "thinking…";
  if (eventType.startsWith("text")) return "writing…";
  return undefined;
}

/** "Edit manager.ts · 1m46s · ↓ 14.5k tok · esc to interrupt" */
export function composeWorkingMessage(options: {
  activity?: string;
  elapsedMs: number;
  outputTokens: number;
}): string {
  const parts = [options.activity ?? "Working...", formatDuration(options.elapsedMs)];
  if (options.outputTokens > 0) {
    parts.push(`↓ ${formatTokens(options.outputTokens)}`);
  }
  parts.push("esc to interrupt");
  return parts.join(" · ");
}
