import { describe, expect, it } from "vitest";
import { runWorkflowSandbox } from "./src/sandbox.ts";

const noAgents = {
  onPhase: () => {},
  onLog: () => {},
  runAgent: async () => ({ ok: true, output: "x" }),
};

describe("sandbox escape hardening", () => {
  it("host-function constructor cannot read the host environment", async () => {
    process.env.SECRET_SENTINEL = "TOPSECRET42";
    const result = await runWorkflowSandbox({
      body: `return agent.constructor("return process.env.SECRET_SENTINEL")();`,
      args: null,
      maxAgentCalls: 32,
      handlers: noAgents,
    });
    const leaked =
      result.ok && typeof result.value === "string" &&
      result.value.includes("TOPSECRET42");
    expect(leaked).toBe(false);
  }, 20_000);

  it("constructor path cannot bypass determinism guards", async () => {
    const result = await runWorkflowSandbox({
      body: `return phase.constructor("return Date.now()")();`,
      args: null,
      maxAgentCalls: 32,
      handlers: noAgents,
    });
    // Must not return a real timestamp number.
    expect(result.ok && typeof result.value === "number").toBe(false);
  }, 20_000);

  it("no injected value exposes a working host Function constructor", async () => {
    process.env.SECRET_SENTINEL = "TOPSECRET42";
    for (const expr of [
      "args.constructor.constructor",
      "budget.constructor.constructor",
      "({}).constructor.constructor",
      "[].constructor.constructor",
      "parallel.constructor",
      "phase.constructor",
    ]) {
      const result = await runWorkflowSandbox({
        body: `return (${expr})("return process.env.SECRET_SENTINEL")();`,
        args: { x: 1 },
        maxAgentCalls: 32,
        handlers: noAgents,
      });
      const leaked =
        result.ok &&
        typeof result.value === "string" &&
        result.value.includes("TOPSECRET42");
      expect(leaked, expr).toBe(false);
    }
  }, 30_000);
});
