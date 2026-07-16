import { describe, expect, it } from "vitest";
import { createAgentRunner, type RunnerEvent } from "./src/runner.ts";

// These paths return before createChild, so a real model registry is
// never touched — a minimal context is enough to exercise finalization.
function fakeContext() {
  return {
    cwd: process.cwd(),
    projectTrusted: false,
    modelRegistry: {} as never,
    parentModel: undefined,
  };
}

function collect() {
  const events: RunnerEvent[] = [];
  return { events, onEvent: (e: RunnerEvent) => events.push(e) };
}

describe("createAgentRunner finalization", () => {
  it("emits exactly one settled event when the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { events, onEvent } = collect();
    const runner = createAgentRunner({
      context: fakeContext(),
      signal: controller.signal,
      onEvent,
    });

    const outcome = await runner.run({ id: 1, prompt: "x", opts: {} });
    expect(outcome.ok).toBe(false);
    expect(events.filter((e) => e.state === "started")).toHaveLength(1);
    const settled = events.filter((e) => e.state === "settled");
    expect(settled).toHaveLength(1);
    expect(settled[0].ok).toBe(false);
  });

  it("emits a settled event for an unknown agent type", async () => {
    const { events, onEvent } = collect();
    const runner = createAgentRunner({ context: fakeContext(), onEvent });

    const outcome = await runner.run({
      id: 2,
      prompt: "x",
      opts: { agentType: "nope-not-a-real-role" },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("Unknown agentType");
    expect(events.filter((e) => e.state === "settled")).toHaveLength(1);
  });
});
