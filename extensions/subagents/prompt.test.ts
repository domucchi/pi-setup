import { describe, expect, it } from "vitest";
import { buildCheckResult, describeDuration, describeStatus } from "./prompt.ts";
import type { SubagentSnapshot } from "./src/manager.ts";

function snapshot(overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
  return {
    id: "sub-1",
    title: "map workspace",
    agentType: "explore",
    cwd: "/tmp",
    status: "working",
    finalText: "",
    errorText: null,
    lastActivity: "✓ read",
    recentActivity: ["→ read", "✓ read"],
    toolCalls: 1,
    prompt: "Map the workspace layout and report back.",
    startedAt: Date.now() - 44_000,
    settledAt: null,
    runs: 1,
    tokens: null,
    contextWindow: null,
    sessionFile: undefined,
    model: "openai-codex/gpt-5.6-sol",
    thinking: "medium",
    ...overrides,
  };
}

describe("describeStatus", () => {
  it("shows live activity while working", () => {
    expect(describeStatus(snapshot())).toBe("working (✓ read)");
    expect(describeStatus(snapshot({ status: "idle" }))).toBe("finished");
    expect(
      describeStatus(snapshot({ status: "failed", errorText: "boom" })),
    ).toBe("failed (boom)");
  });
});

describe("describeDuration", () => {
  it("shows seconds within minutes", () => {
    const t = 1_000_000;
    expect(describeDuration(t, t + 44_000)).toBe("44s");
    expect(describeDuration(t, t + 83_000)).toBe("1min 23s");
  });
});

describe("buildCheckResult", () => {
  it("includes runtime and context usage", () => {
    const text = buildCheckResult(
      snapshot({ tokens: 12_000, contextWindow: 200_000 }),
    );
    expect(text).toContain("openai-codex/gpt-5.6-sol · thinking medium");
    expect(text).toContain("context: 6% of 200k");
  });
});
