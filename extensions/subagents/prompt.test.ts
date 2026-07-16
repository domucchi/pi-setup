import { describe, expect, it } from "vitest";
import { buildPickerLabel, describeDuration, shortModel } from "./prompt.ts";
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

describe("shortModel", () => {
  it("strips the provider prefix", () => {
    expect(shortModel("openai-codex/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(shortModel("bare-id")).toBe("bare-id");
    expect(shortModel(undefined)).toBeUndefined();
  });
});

describe("buildPickerLabel", () => {
  it("shows id, live status, role, model, and title", () => {
    const label = buildPickerLabel(snapshot());
    expect(label).toContain("sub-1 ◆ working (✓ read)");
    expect(label).toContain("explore · gpt-5.6-sol · map workspace");
  });

  it("omits the model when unknown", () => {
    const label = buildPickerLabel(snapshot({ model: undefined }));
    expect(label).toContain("explore · map workspace");
  });
});

describe("describeDuration", () => {
  it("shows seconds within minutes", () => {
    const t = 1_000_000;
    expect(describeDuration(t, t + 44_000)).toBe("44s");
    expect(describeDuration(t, t + 83_000)).toBe("1min 23s");
  });
});
