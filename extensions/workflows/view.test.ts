import { describe, expect, it } from "vitest";
import {
  agentElapsedMs,
  agentStats,
  aggregateTokens,
  groupAgentsByPhase,
  groupCounts,
  statusWord,
  UNPHASED_TITLE,
  type AgentView,
} from "./src/view.ts";

function agent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    seq: 1,
    label: "agent-1",
    state: "running",
    activity: [],
    startedAt: 0,
    ...overrides,
  };
}

describe("groupAgentsByPhase", () => {
  it("keeps declared phases in order, even while empty", () => {
    const groups = groupAgentsByPhase(
      [{ title: "Find" }, { title: "Verify", detail: "adversarial" }],
      [agent({ phase: "Verify" })],
    );
    expect(groups.map((g) => g.title)).toEqual(["Find", "Verify"]);
    expect(groups[0].agents).toHaveLength(0);
    expect(groups[1].agents).toHaveLength(1);
    expect(groups[1].detail).toBe("adversarial");
  });

  it("appends undeclared phases in first-seen order", () => {
    const groups = groupAgentsByPhase(
      [{ title: "Find" }],
      [agent({ phase: "Extra" }), agent({ seq: 2, phase: "Find" })],
    );
    expect(groups.map((g) => g.title)).toEqual(["Find", "Extra"]);
  });

  it("collects unphased agents into a trailing group", () => {
    const groups = groupAgentsByPhase(
      [{ title: "Find" }],
      [agent(), agent({ seq: 2, phase: "Find" })],
    );
    expect(groups.map((g) => g.title)).toEqual(["Find", UNPHASED_TITLE]);
    expect(groups[1].agents).toHaveLength(1);
  });

  it("uses a single Agents group when the workflow never phases", () => {
    const groups = groupAgentsByPhase(undefined, [agent(), agent({ seq: 2 })]);
    expect(groups.map((g) => g.title)).toEqual(["Agents"]);
    expect(groups[0].agents).toHaveLength(2);
  });

  it("returns no groups for no phases and no agents", () => {
    expect(groupAgentsByPhase(undefined, [])).toEqual([]);
  });
});

describe("groupCounts", () => {
  it("counts states", () => {
    const counts = groupCounts([
      agent(),
      agent({ seq: 2, state: "ok" }),
      agent({ seq: 3, state: "failed" }),
      agent({ seq: 4, state: "ok" }),
    ]);
    expect(counts).toEqual({ total: 4, done: 2, failed: 1, running: 1 });
  });
});

describe("agentElapsedMs", () => {
  it("prefers the settled duration over wall clock", () => {
    expect(agentElapsedMs(agent({ durationMs: 5_000, startedAt: 0 }), 99_000)).toBe(
      5_000,
    );
    expect(agentElapsedMs(agent({ startedAt: 10_000 }), 25_000)).toBe(15_000);
  });
});

describe("agentStats", () => {
  it("joins the known parts", () => {
    expect(
      agentStats(
        agent({ model: "openai/gpt-5.6-sol", tokens: 12_345, toolCalls: 4 }),
      ),
    ).toBe("gpt-5.6-sol · 12.3k tok · 4 tools");
    expect(agentStats(agent({ toolCalls: 1 }))).toBe("1 tool");
    expect(agentStats(agent())).toBe("");
  });
});

describe("aggregateTokens", () => {
  it("sums only known token counts", () => {
    expect(
      aggregateTokens([agent({ tokens: 100 }), agent(), agent({ tokens: 50 })]),
    ).toBe(150);
    expect(aggregateTokens([agent()])).toBeUndefined();
  });
});

describe("statusWord", () => {
  it("maps completed to done", () => {
    expect(statusWord("completed")).toBe("done");
    expect(statusWord("running")).toBe("running");
  });
});
