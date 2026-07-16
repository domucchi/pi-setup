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

  // The determinism guards are ADVISORY (see sandbox-child.cjs): they catch
  // honest nondeterminism, not an adversary. These cover the common bypasses
  // we DO lock — reassigning/deleting/shadowing the guarded bindings must
  // fail (either throw → run not ok, or the guard still throws → not a
  // number). Deep prototype paths are deliberately not chased.
  it("locked determinism guards resist reassignment, deletion, and shadowing", async () => {
    for (const body of [
      "Math.random = () => 1; return Math.random();",
      "Date.now = () => 1; return Date.now();",
      "delete Math.random; return Math.random();",
      "'use strict'; Math.random = () => 1; return Math.random();",
      "Math = { random: () => 7 }; return Math.random();",
      "Date = { now: () => 7 }; return Date.now();",
      "Object.defineProperty(Math, 'random', { value: () => 1 }); return Math.random();",
    ]) {
      const result = await runWorkflowSandbox({
        body,
        args: null,
        maxAgentCalls: 32,
        handlers: noAgents,
      });
      // Guard held if the run failed (throw) OR the value is not a number
      // (the throwing guard still ran). A numeric result means it was defeated.
      const defeated = result.ok && typeof result.value === "number";
      expect(defeated, body).toBe(false);
    }
  }, 40_000);

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
