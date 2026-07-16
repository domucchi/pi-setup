import { describe, expect, it } from "vitest";
import type { ChildEvent, ChildHandle } from "./src/child.ts";
import { MAX_WORKING, SubagentManager } from "./src/manager.ts";

/** Stub child: settles when the test says so. */
function stubChildFactory() {
  const children: {
    onEvent: (event: ChildEvent) => void;
    prompts: string[];
    steers: string[];
    disposed: boolean;
    streaming: boolean;
  }[] = [];

  const createChild = async (options: {
    onEvent: (event: ChildEvent) => void;
  }): Promise<ChildHandle> => {
    const record = {
      onEvent: options.onEvent,
      prompts: [] as string[],
      steers: [] as string[],
      disposed: false,
      streaming: false,
    };
    children.push(record);
    return {
      sessionFile: undefined,
      prompt: (text) => {
        record.prompts.push(text);
        record.streaming = true;
        record.onEvent({ type: "run-started" });
      },
      steer: async (text) => {
        record.steers.push(text);
      },
      isStreaming: () => record.streaming,
      interrupt: async () => {
        record.streaming = false;
      },
      dispose: async () => {
        record.disposed = true;
      },
      usage: () => ({ tokens: 100, contextWindow: 1000 }),
      finalText: () => "",
      transcriptTail: () => [],
    };
  };

  const settle = (index: number, finalText = "report") => {
    children[index].streaming = false;
    children[index].onEvent({
      type: "run-settled",
      outcome: { kind: "completed", finalText },
    });
  };

  return { createChild, children, settle };
}

describe("SubagentManager", () => {
  it("spawn → settle → wait returns the report", async () => {
    const stub = stubChildFactory();
    const settled: string[] = [];
    const manager = new SubagentManager({
      createChild: stub.createChild,
      onRunSettled: (s) => settled.push(s.id),
    });
    const snapshot = await manager.spawn({
      title: "t",
      agentType: "worker",
      prompt: "do it",
      cwd: "/tmp",
    });
    expect(snapshot.status).toBe("working");
    expect(stub.children[0].prompts).toEqual(["do it"]);

    const wait = manager.wait([snapshot.id]);
    stub.settle(0, "all done");
    const [result] = await wait;
    expect(result.status).toBe("idle");
    expect(result.finalText).toBe("all done");
    expect(settled).toEqual([snapshot.id]);
  });

  it("reports waited settles as consumed", async () => {
    const stub = stubChildFactory();
    const consumed: boolean[] = [];
    const manager = new SubagentManager({
      createChild: stub.createChild,
      onRunSettled: (_s, c) => consumed.push(c),
    });
    const a = await manager.spawn({ title: "a", agentType: "worker", prompt: "x", cwd: "/" });
    const wait = manager.wait([a.id]);
    stub.settle(0);
    await wait;
    const b = await manager.spawn({ title: "b", agentType: "worker", prompt: "y", cwd: "/" });
    stub.settle(1);
    await manager.wait([b.id]);
    expect(consumed[0]).toBe(true); // waiter attached before settle
    expect(consumed[1]).toBe(false); // settled unobserved
  });

  it("send steers a streaming child and re-runs an idle one", async () => {
    const stub = stubChildFactory();
    const manager = new SubagentManager({ createChild: stub.createChild });
    const snapshot = await manager.spawn({
      title: "t",
      agentType: "worker",
      prompt: "first",
      cwd: "/",
    });

    await manager.send(snapshot.id, "mid-run steer");
    expect(stub.children[0].steers).toEqual(["mid-run steer"]);

    stub.settle(0);
    const after = await manager.send(snapshot.id, "follow-up");
    expect(after.status).toBe("working");
    expect(after.runs).toBe(2);
    expect(stub.children[0].prompts).toEqual(["first", "follow-up"]);
  });

  it("enforces the working cap including re-runs", async () => {
    const stub = stubChildFactory();
    const manager = new SubagentManager({ createChild: stub.createChild });
    const first = await manager.spawn({ title: "0", agentType: "worker", prompt: "p", cwd: "/" });
    for (let i = 1; i < MAX_WORKING; i++) {
      await manager.spawn({ title: String(i), agentType: "worker", prompt: "p", cwd: "/" });
    }
    await expect(
      manager.spawn({ title: "over", agentType: "worker", prompt: "p", cwd: "/" }),
    ).rejects.toThrow(/Already running/);

    stub.settle(0);
    await manager.wait([first.id]);
    // A slot freed; re-running the idle child takes it again.
    await manager.send(first.id, "again");
    await expect(
      manager.spawn({ title: "over2", agentType: "worker", prompt: "p", cwd: "/" }),
    ).rejects.toThrow(/Already running/);
  });

  it("cancel disposes and blocks further sends", async () => {
    const stub = stubChildFactory();
    const manager = new SubagentManager({ createChild: stub.createChild });
    const snapshot = await manager.spawn({
      title: "t",
      agentType: "worker",
      prompt: "p",
      cwd: "/",
    });
    const [cancelled] = await manager.cancel([snapshot.id]);
    expect(cancelled.status).toBe("cancelled");
    expect(stub.children[0].disposed).toBe(true);
    await expect(manager.send(snapshot.id, "x")).rejects.toThrow(/No live subagent/);
  });

  it("failed runs carry the error and can be re-run via send", async () => {
    const stub = stubChildFactory();
    const manager = new SubagentManager({ createChild: stub.createChild });
    const snapshot = await manager.spawn({
      title: "t",
      agentType: "worker",
      prompt: "p",
      cwd: "/",
    });
    stub.children[0].streaming = false;
    stub.children[0].onEvent({
      type: "run-settled",
      outcome: { kind: "failed", errorText: "boom" },
    });
    expect(manager.get(snapshot.id)?.status).toBe("failed");
    expect(manager.get(snapshot.id)?.errorText).toBe("boom");

    const rerun = await manager.send(snapshot.id, "try again");
    expect(rerun.status).toBe("working");
    expect(rerun.errorText).toBeNull();
  });
});
