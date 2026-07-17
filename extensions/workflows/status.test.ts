import { describe, expect, it } from "vitest";
import { buildWorkflowStatus } from "./prompt.ts";

describe("buildWorkflowStatus", () => {
  it("summarizes a running run with per-agent lines and logs", () => {
    const now = Date.now();
    const text = buildWorkflowStatus(
      {
        runId: "wf-abc",
        name: "review-diff",
        description: "d",
        status: "running",
        startedAt: now - 30_000,
        settledAt: null,
        agentCount: 2,
      },
      {
        currentPhase: "Verify",
        agents: [
          {
            seq: 1,
            label: "scan",
            phase: "Triage",
            state: "ok",
            model: "openai/gpt-5.6-sol",
            tokens: 1200,
            toolCalls: 3,
            startedAt: now - 30_000,
            durationMs: 12_000,
          },
          {
            seq: 2,
            label: "verify",
            phase: "Verify",
            state: "running",
            startedAt: now - 10_000,
          },
        ],
        logs: ["triage done", "verifying"],
        dir: "/tmp/wf-abc",
      },
    );
    expect(text).toContain('"review-diff" (wf-abc) — running, 1/2 agents settled');
    expect(text).toContain("Current phase: Verify");
    expect(text).toContain("✓ scan — Triage · openai/gpt-5.6-sol · 1200 tok · 3 tool calls · 12s");
    expect(text).toContain("◆ verify — Verify");
    expect(text).toContain("  verifying");
    expect(text).toContain("Artifacts: /tmp/wf-abc");
  });

  it("includes the run error and clips agent errors", () => {
    const text = buildWorkflowStatus(
      {
        runId: "wf-x",
        name: "n",
        description: "d",
        status: "failed",
        startedAt: 0,
        settledAt: 1_000,
        agentCount: 1,
        error: "boom",
      },
      {
        agents: [
          {
            seq: 1,
            label: "a",
            state: "failed",
            startedAt: 0,
            durationMs: 500,
            error: "x".repeat(300),
          },
        ],
        logs: [],
        dir: "/tmp/wf-x",
      },
    );
    expect(text).toContain("Error: boom");
    expect(text).toContain(`✗ a — 1s — ${"x".repeat(120)}`);
    expect(text).not.toContain("x".repeat(121));
  });
});
