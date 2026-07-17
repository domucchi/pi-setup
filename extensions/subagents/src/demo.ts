/**
 * Fixture data for `/subagents demo` — preview the dashboard UI without
 * spawning real children. Timestamps are relative to `now`, so the
 * working agent's duration ticks live; x (cancel) mutates the fixtures.
 */

import type { SubagentsHost } from "../dashboard.ts";
import type { SubagentSnapshot } from "./manager.ts";

const AUDIT_PROMPT = `Audit extensions/subagents for lifecycle bugs.

Scope:
- child disposal on session_shutdown and cancel
- settle-guard idempotency (one settle per run)
- capacity reservation before the first await

Report: file:line, what breaks, and a minimal reproduction sketch.
Do not fix anything; this is read-only.`;

const MAP_REPORT = `Repo layout:

- extensions/<name>/index.ts — wiring (tools, commands, events)
- extensions/<name>/prompt.ts — all model-facing text
- extensions/<name>/src/*.ts — pure logic, vitest-covered
- extensions/shared/ — cross-extension helpers (overlay, formats, env)
- skills/, agents/, themes/ — symlinked into ~/.pi/agent by install.sh

Notable: workflows reuses subagents' createChild; both dashboards
share extensions/shared/overlay.ts. 172 tests, tsc strict.`;

export function createDemoSubagents(now: number): SubagentSnapshot[] {
  return [
    {
      id: "sub-1",
      title: "audit subagent lifecycle",
      agentType: "worker",
      cwd: "/Users/you/code/pi-setup",
      status: "working",
      finalText: "",
      errorText: null,
      lastActivity: "→ read",
      recentActivity: ["✓ rg", "→ read", "✓ read", "→ read"],
      toolCalls: 9,
      prompt: AUDIT_PROMPT,
      startedAt: now - 73_000,
      settledAt: null,
      runs: 1,
      tokens: 22_400,
      contextWindow: 200_000,
      sessionFile: undefined,
      model: "anthropic/claude-sonnet-5",
      thinking: "medium",
    },
    {
      id: "sub-2",
      title: "map repo layout",
      agentType: "explore",
      cwd: "/Users/you/code/pi-setup",
      status: "idle",
      finalText: MAP_REPORT,
      errorText: null,
      lastActivity: "✓ fd",
      recentActivity: ["→ fd", "✓ fd", "→ rg", "✓ rg"],
      toolCalls: 6,
      prompt: "Map the repository layout: one line per top-level area, note anything unusual.",
      startedAt: now - 6 * 60_000,
      settledAt: now - 5 * 60_000,
      runs: 1,
      tokens: 9_800,
      contextWindow: 372_000,
      sessionFile: undefined,
      model: "openai-codex/gpt-5.6-terra",
      thinking: "low",
    },
    {
      id: "sub-3",
      title: "fix flaky watchdog test",
      agentType: "worker",
      cwd: "/Users/you/code/pi-setup",
      status: "failed",
      finalText: "Reproduced twice under --repeat 50; suspect the fake timer drift in child.test.ts.",
      errorText: 'Tool call "bash" timed out after 3 minutes.',
      lastActivity: "✗ bash",
      recentActivity: ["✓ edit", "→ bash", "✗ bash"],
      toolCalls: 11,
      prompt: "Make child.test.ts watchdog case deterministic; it flakes under repetition.",
      startedAt: now - 14 * 60_000,
      settledAt: now - 10 * 60_000,
      runs: 2,
      tokens: 41_300,
      contextWindow: 200_000,
      sessionFile: undefined,
      model: "anthropic/claude-sonnet-5",
      thinking: "high",
    },
    {
      id: "sub-4",
      title: "summarize CI failures",
      agentType: "explore",
      cwd: "/Users/you/code/pi-setup",
      status: "cancelled",
      finalText: "",
      errorText: null,
      lastActivity: "→ bash",
      recentActivity: ["→ bash"],
      toolCalls: 1,
      prompt: "Summarize the last 5 CI failures by root cause.",
      startedAt: now - 22 * 60_000,
      settledAt: now - 21 * 60_000,
      runs: 1,
      tokens: 1_200,
      contextWindow: 372_000,
      sessionFile: undefined,
      model: "openai-codex/gpt-5.6-sol",
      thinking: "low",
    },
  ];
}

const DEMO_TRANSCRIPTS: Record<string, string[]> = {
  "sub-1": [
    "> Audit extensions/subagents for lifecycle bugs.",
    "  → rg",
    "Scanning manager.ts for settle paths…",
    "  → read",
    "settleRun guards on status !== \"working\" — checking cancel path next.",
    "  → read",
  ],
  "sub-2": [
    "> Map the repository layout…",
    "  → fd",
    "  → rg",
    "Repo layout:",
    "- extensions/<name>/index.ts — wiring (tools, commands, events)",
    "- extensions/shared/ — cross-extension helpers",
  ],
  "sub-3": [
    "> Make child.test.ts watchdog case deterministic…",
    "  → read",
    "  → edit",
    "Switched to injected clock; rerunning the repeat suite.",
    "  → bash",
    "(bash timed out)",
  ],
  "sub-4": ["> Summarize the last 5 CI failures by root cause.", "  → bash"],
};

/** Host over mutable fixtures — x (cancel) behaves like the real thing. */
export function demoSubagentsHost(agents: SubagentSnapshot[]): SubagentsHost {
  return {
    list: () => agents,
    transcriptTail: (id, lines) => (DEMO_TRANSCRIPTS[id] ?? []).slice(-lines),
    cancel: (id) => {
      const snapshot = agents.find((s) => s.id === id);
      if (!snapshot || snapshot.status === "cancelled") return;
      snapshot.status = "cancelled";
      snapshot.settledAt ??= Date.now();
    },
  };
}
