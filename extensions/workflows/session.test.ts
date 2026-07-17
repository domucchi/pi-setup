import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { referencedWorkflowRunIds } from "./src/session.ts";

describe("referencedWorkflowRunIds", () => {
  it("collects workflow tool results, resume lineage, and completion messages", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "workflow",
          details: { runId: "wf-current", resumedFrom: "wf-parent" },
        },
      },
      {
        type: "custom_message",
        customType: "workflow-result",
        details: { runId: "wf-background" },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "read",
          details: { runId: "wf-unrelated" },
        },
      },
      {
        type: "custom_message",
        customType: "something-else",
        details: { runId: "wf-unrelated-2" },
      },
    ] as unknown as SessionEntry[];

    expect([...referencedWorkflowRunIds(entries)]).toEqual([
      "wf-current",
      "wf-parent",
      "wf-background",
    ]);
  });

  it("ignores malformed run ids", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "workflow_status",
          details: { runId: "../escape" },
        },
      },
    ] as unknown as SessionEntry[];
    expect(referencedWorkflowRunIds(entries).size).toBe(0);
  });
});
