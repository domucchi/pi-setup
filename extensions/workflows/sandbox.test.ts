import { describe, expect, it } from "vitest";
import {
  runWorkflowSandbox,
  type SandboxAgentRequest,
  type SandboxHandlers,
} from "./src/sandbox.ts";

function handlers(
  runAgent?: SandboxHandlers["runAgent"],
): SandboxHandlers & { phases: string[]; logs: string[] } {
  const phases: string[] = [];
  const logs: string[] = [];
  return {
    phases,
    logs,
    onPhase: (t) => phases.push(t),
    onLog: (m) => logs.push(m),
    runAgent:
      runAgent ??
      (async (request: SandboxAgentRequest) => ({
        ok: true,
        output: `echo:${request.prompt}`,
      })),
  };
}

describe("runWorkflowSandbox", () => {
  it("runs a script end to end: phases, logs, agents, result", async () => {
    const h = handlers();
    const result = await runWorkflowSandbox({
      body: `
        phase("Find");
        log("starting");
        const a = await agent("one");
        const b = await parallel([() => agent("two"), () => agent("three")]);
        phase("Done");
        return { a, b };
      `,
      args: null,
      maxAgentCalls: 32,
      handlers: h,
    });
    expect(result).toEqual({
      ok: true,
      value: { a: "echo:one", b: ["echo:two", "echo:three"] },
    });
    expect(h.phases).toEqual(["Find", "Done"]);
    expect(h.logs).toEqual(["starting"]);
  }, 20_000);

  it("returns structured results and passes opts through", async () => {
    let seenOpts: SandboxAgentRequest["opts"] | undefined;
    const h = handlers(async (request) => {
      seenOpts = request.opts;
      return { ok: true, output: "text", structured: { count: 3 } };
    });
    const result = await runWorkflowSandbox({
      body: `
        const r = await agent("x", { schema: { type: "object" }, agentType: "explore", label: "scout" });
        return r.count;
      `,
      args: null,
      maxAgentCalls: 32,
      handlers: h,
    });
    expect(result).toEqual({ ok: true, value: 3 });
    expect(seenOpts?.agentType).toBe("explore");
    expect(seenOpts?.label).toBe("scout");
    expect(seenOpts?.schema).toEqual({ type: "object" });
  }, 20_000);

  it("failed agents resolve to null; pipeline drops throwing stages", async () => {
    const h = handlers(async (request) =>
      request.prompt === "bad"
        ? { ok: false, output: "", error: "boom" }
        : { ok: true, output: request.prompt.toUpperCase() },
    );
    const result = await runWorkflowSandbox({
      body: `
        const results = await pipeline(
          ["ok1", "bad", "ok2"],
          (item) => agent(item),
          (prev) => { if (prev === null) throw new Error("skip"); return prev + "!"; },
        );
        return results;
      `,
      args: null,
      maxAgentCalls: 32,
      handlers: h,
    });
    expect(result).toEqual({ ok: true, value: ["OK1!", null, "OK2!"] });
  }, 20_000);

  it("exposes frozen args and blocks nondeterminism + codegen", async () => {
    const h = handlers();
    const frozen = await runWorkflowSandbox({
      body: `args.items.push(4); return args.items;`,
      args: { items: [1, 2, 3] },
      maxAgentCalls: 32,
      handlers: h,
    });
    expect(frozen.ok).toBe(false);

    for (const body of [
      "return Math.random()",
      "return Date.now()",
      "return new Date().toISOString()",
      "return eval('1+1')",
      "return new Function('return 1')()",
    ]) {
      const result = await runWorkflowSandbox({
        body,
        args: null,
        maxAgentCalls: 32,
        handlers: handlers(),
      });
      expect(result.ok, body).toBe(false);
    }
  }, 40_000);

  it("cannot reach fs, network, or process from the script", async () => {
    for (const body of [
      "return require('node:fs').readFileSync('/etc/hosts', 'utf8')",
      "return process.env",
      "return typeof fetch === 'function' ? await fetch('http://127.0.0.1:1') : 'no-fetch'",
    ]) {
      const result = await runWorkflowSandbox({
        body,
        args: null,
        maxAgentCalls: 32,
        handlers: handlers(),
      });
      // Either the capability is undefined (throws) or the attempt fails —
      // it must never succeed with real data.
      if (result.ok) expect(result.value).toBe("no-fetch");
    }
  }, 30_000);

  it("enforces the agent call cap and unsettled-agent detection", async () => {
    const capped = await runWorkflowSandbox({
      body: `
        for (let i = 0; i < 3; i++) await agent("x" + i);
        return "done";
      `,
      args: null,
      maxAgentCalls: 2,
      handlers: handlers(),
    });
    expect(capped.ok).toBe(false);

    const unsettled = await runWorkflowSandbox({
      body: `agent("never awaited"); return 1;`,
      args: null,
      maxAgentCalls: 32,
      handlers: handlers(async () => new Promise(() => {})),
    });
    expect(unsettled.ok).toBe(false);
    if (!unsettled.ok) expect(unsettled.error).toContain("still running");
  }, 20_000);

  it("aborts via signal", async () => {
    const controller = new AbortController();
    const pending = runWorkflowSandbox({
      body: `await agent("hang"); return 1;`,
      args: null,
      maxAgentCalls: 32,
      handlers: handlers(async () => new Promise(() => {})),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 500);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("aborted");
  }, 20_000);
});
