import type { SessionEntry } from "@earendil-works/pi-coding-agent";

function addRunId(ids: Set<string>, value: unknown) {
  if (typeof value === "string" && /^wf-[A-Za-z0-9_-]+$/.test(value)) {
    ids.add(value);
  }
}

/** Workflow artifacts explicitly referenced on the active session branch. */
export function referencedWorkflowRunIds(entries: readonly SessionEntry[]) {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      if (
        entry.message.toolName !== "workflow" &&
        entry.message.toolName !== "workflow_status"
      ) {
        continue;
      }
      const details = entry.message.details as
        | { runId?: unknown; resumedFrom?: unknown }
        | undefined;
      addRunId(ids, details?.runId);
      addRunId(ids, details?.resumedFrom);
      continue;
    }
    if (entry.type === "custom_message" && entry.customType === "workflow-result") {
      const details = entry.details as { runId?: unknown } | undefined;
      addRunId(ids, details?.runId);
    }
  }
  return ids;
}
