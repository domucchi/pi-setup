import { describe, expect, it } from "vitest";
import {
  buildReportTool,
  createAgentRunner,
  type RunnerEvent,
} from "./src/runner.ts";

describe("buildReportTool exactly-once", () => {
  it("records the first result and rejects a second call", async () => {
    const capture: { value?: unknown; reported?: boolean } = {};
    const tool = buildReportTool({ type: "object" }, capture);
    await tool.execute("c1", { answer: "first" }, undefined as never, undefined, undefined as never);
    expect(capture.value).toEqual({ answer: "first" });
    expect(capture.reported).toBe(true);
    await expect(
      tool.execute("c2", { answer: "second" }, undefined as never, undefined, undefined as never),
    ).rejects.toThrow(/already called/);
    expect(capture.value).toEqual({ answer: "first" }); // unchanged
  });
});

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
