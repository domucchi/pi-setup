/**
 * Fixture data for `/workflows demo` — preview the dashboard UI without
 * spinning up real agents. Timestamps are relative to `now`, so running
 * durations tick live; x (stop) mutates the fixtures like the real thing.
 */

import type { DashboardHost, RunView } from "../dashboard.ts";

const REVIEW_PROMPT = `Review the diff between main and HEAD for correctness bugs.

Focus on:
- off-by-one errors and boundary conditions
- error handling on the async paths
- state that leaks between retries

Report each finding as: file, line, severity, one-line rationale.
Do not report style nits, do not propose refactors.

Context: this is a TypeScript pi-extension repo; tests run under vitest.
The reviewed change adds a two-pane workflow dashboard.`;

export function createDemoRuns(now: number): RunView[] {
  const running: RunView = {
    record: {
      runId: "wf-demo01",
      name: "review-diff",
      description: "Review the working diff across 3 lenses, verify findings",
      status: "running",
      startedAt: now - 95_000,
      settledAt: null,
      agentCount: 5,
    },
    phases: [
      { title: "Triage" },
      { title: "Verify", detail: "adversarial re-check" },
      { title: "Report" },
    ],
    currentPhase: "Verify",
    agents: [
      {
        seq: 1,
        label: "scan-src",
        phase: "Triage",
        state: "ok",
        prompt: REVIEW_PROMPT,
        agentType: "explore",
        model: "anthropic/claude-sonnet-5",
        tokens: 18_400,
        contextWindow: 200_000,
        toolCalls: 7,
        activity: ["→ rg", "✓ rg", "→ read", "✓ read"],
        startedAt: now - 95_000,
        durationMs: 41_000,
        output:
          "Found 7 candidate issues:\n1. runner.ts:88 semaphore leak on throw\n2. view.ts:41 off-by-one in windowSlice\n3. dashboard.ts:210 stale index after refresh\n(4 more below severity threshold)",
      },
      {
        seq: 2,
        label: "scan-tests",
        phase: "Triage",
        state: "ok",
        prompt: "Scan the test files of the diff for weakened or deleted assertions.",
        agentType: "explore",
        model: "openai-codex/gpt-5.6-sol",
        tokens: 11_050,
        contextWindow: 372_000,
        toolCalls: 5,
        activity: ["→ rg", "✓ rg", "✓ read"],
        startedAt: now - 95_000,
        durationMs: 38_000,
        output: "3 candidates: prompt.test.ts lost the picker-label cases.",
      },
      {
        seq: 3,
        label: "scan-config",
        phase: "Triage",
        state: "ok",
        prompt: "Check tsconfig/vitest config drift introduced by the diff.",
        agentType: "explore",
        model: "openai-codex/gpt-5.6-terra",
        tokens: 4_800,
        contextWindow: 372_000,
        toolCalls: 3,
        activity: ["→ read", "✓ read"],
        startedAt: now - 93_000,
        durationMs: 22_000,
        output: "No config drift.",
      },
      {
        seq: 4,
        label: "verify-semaphore-leak",
        phase: "Verify",
        state: "running",
        prompt:
          "Adversarially verify: runner.ts:88 leaks a semaphore slot when createChild throws.\nTry to construct the failing path; default to refuted if you cannot.",
        agentType: "worker",
        model: "anthropic/claude-sonnet-5",
        tokens: 9_200,
        contextWindow: 200_000,
        toolCalls: 4,
        activity: ["✓ read", "→ bash", "✓ bash", "→ read"],
        startedAt: now - 33_000,
      },
      {
        seq: 5,
        label: "verify-windowslice",
        phase: "Verify",
        state: "failed",
        prompt: "Adversarially verify: view.ts:41 off-by-one in windowSlice.",
        agentType: "worker",
        model: "openai-codex/gpt-5.6-sol",
        tokens: 6_400,
        contextWindow: 372_000,
        toolCalls: 6,
        activity: ["→ bash", "✗ bash"],
        startedAt: now - 30_000,
        durationMs: 19_000,
        error: 'Tool call "bash" timed out after 3 minutes.',
      },
    ],
    logs: ["triage: 10 candidates, 2 above threshold", "verifying 2 findings"],
    dir: "~/.pi/agent/workflows/wf-demo01",
  };

  const completed: RunView = {
    record: {
      runId: "wf-demo02",
      name: "migrate-tests",
      description: "Port the remaining tape tests to vitest",
      status: "completed",
      startedAt: now - 31 * 60_000,
      settledAt: now - 26 * 60_000,
      agentCount: 3,
    },
    phases: [{ title: "Discover" }, { title: "Transform" }],
    agents: [
      {
        seq: 1,
        label: "list-tape-tests",
        phase: "Discover",
        state: "ok",
        prompt: "List every remaining tape test file with its assertion count.",
        agentType: "explore",
        model: "openai-codex/gpt-5.6-terra",
        tokens: 7_900,
        contextWindow: 372_000,
        toolCalls: 4,
        activity: ["✓ fd", "✓ rg"],
        startedAt: now - 31 * 60_000,
        durationMs: 47_000,
        output: "6 files, 41 assertions total.",
      },
      {
        seq: 2,
        label: "port-batch-1",
        phase: "Transform",
        state: "ok",
        prompt: "Port files 1-3 to vitest, keep assertion semantics identical.",
        agentType: "worker",
        model: "anthropic/claude-sonnet-5",
        tokens: 31_200,
        contextWindow: 200_000,
        toolCalls: 14,
        activity: ["✓ edit", "→ bash", "✓ bash"],
        startedAt: now - 30 * 60_000,
        durationMs: 128_000,
        output: "3 files ported, 21/21 assertions green.",
      },
      {
        seq: 3,
        label: "port-batch-2",
        phase: "Transform",
        state: "ok",
        prompt: "Port files 4-6 to vitest, keep assertion semantics identical.",
        agentType: "worker",
        model: "anthropic/claude-sonnet-5",
        tokens: 28_700,
        contextWindow: 200_000,
        toolCalls: 12,
        activity: ["✓ edit", "✓ bash"],
        startedAt: now - 30 * 60_000,
        durationMs: 112_000,
        output: "3 files ported, 20/20 assertions green.",
      },
    ],
    logs: ["6 files discovered", "all batches green"],
    dir: "~/.pi/agent/workflows/wf-demo02",
  };

  const failed: RunView = {
    record: {
      runId: "wf-demo03",
      name: "audit-deps",
      description: "Audit direct dependencies for known CVEs",
      status: "failed",
      startedAt: now - 2 * 60 * 60_000,
      settledAt: now - 2 * 60 * 60_000 + 51_000,
      agentCount: 1,
      error: "workflow script threw: fetch is not defined in the sandbox",
    },
    phases: [{ title: "Audit" }],
    agents: [
      {
        seq: 1,
        label: "audit-typebox",
        phase: "Audit",
        state: "failed",
        prompt: "Check typebox@0.34 for published advisories.",
        agentType: "worker",
        model: "openai-codex/gpt-5.6-sol",
        tokens: 2_100,
        contextWindow: 372_000,
        toolCalls: 1,
        activity: ["→ web_search", "✗ web_search"],
        startedAt: now - 2 * 60 * 60_000,
        durationMs: 44_000,
        error: "EXA_API_KEY missing — web_search unavailable.",
      },
    ],
    logs: [],
    dir: "~/.pi/agent/workflows/wf-demo03",
  };

  return [running, completed, failed];
}

/** Host over mutable fixtures — x (stop) behaves like the real abort. */
export function demoWorkflowsHost(runs: RunView[]): DashboardHost {
  return {
    getRuns: () => runs,
    stop: (runId) => {
      const run = runs.find((r) => r.record.runId === runId);
      if (!run || run.record.status !== "running") return;
      run.record.status = "aborted";
      run.record.settledAt = Date.now();
      for (const agent of run.agents) {
        if (agent.state === "running") {
          agent.state = "failed";
          agent.error = "Run aborted.";
          agent.durationMs = Date.now() - agent.startedAt;
        }
      }
    },
  };
}
