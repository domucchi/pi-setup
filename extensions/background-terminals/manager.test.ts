import { describe, expect, it } from "vitest";
import {
  MAX_RUNNING,
  TerminalManager,
  type TerminalEntry,
} from "./src/manager.ts";

const cwd = process.cwd();

function settledOnce(manager: () => TerminalManager) {
  let resolve!: (entry: TerminalEntry) => void;
  const promise = new Promise<TerminalEntry>((r) => {
    resolve = r;
  });
  return { promise, hooks: { onSettled: resolve, createSpill: () => null } };
}

describe("TerminalManager", () => {
  it("settles done with captured output", async () => {
    const once = settledOnce(() => manager);
    const manager = new TerminalManager(once.hooks);
    const started = manager.start({
      command: "printf out; printf err >&2",
      title: "echo",
      cwd,
    });
    expect(started.status).toBe("running");

    const settled = await once.promise;
    expect(settled.status).toBe("done");
    expect(settled.exitCode).toBe(0);
    expect(settled.stdout.text()).toBe("out");
    expect(settled.stderr.text()).toBe("err");
  });

  it("settles failed with the exit code", async () => {
    const once = settledOnce(() => manager);
    const manager = new TerminalManager(once.hooks);
    manager.start({ command: "exit 3", title: "fail", cwd });
    const settled = await once.promise;
    expect(settled.status).toBe("failed");
    expect(settled.exitCode).toBe(3);
  });

  it("kill settles as killed and resolves after full exit", async () => {
    const manager = new TerminalManager({ createSpill: () => null });
    const started = manager.start({
      command: "sleep 30",
      title: "sleeper",
      cwd,
    });
    const [settled] = await manager.kill([started.id]);
    expect(settled.status).toBe("killed");
    expect(manager.runningCount()).toBe(0);
  });

  it("kill takes down child process trees", async () => {
    const manager = new TerminalManager({ createSpill: () => null });
    // Parent spawns a grandchild that would outlive a naive kill.
    const started = manager.start({
      command: "sleep 30 & wait",
      title: "tree",
      cwd,
    });
    await new Promise((r) => setTimeout(r, 200));
    const [settled] = await manager.kill([started.id]);
    expect(settled.status).toBe("killed");
  });

  it("reports running counts through the hook", async () => {
    const counts: number[] = [];
    let resolveSettle!: () => void;
    const settled = new Promise<void>((r) => {
      resolveSettle = r;
    });
    const manager = new TerminalManager({
      createSpill: () => null,
      onRunningCountChanged: (count) => counts.push(count),
      onSettled: () => resolveSettle(),
    });
    manager.start({ command: "true", title: "quick", cwd });
    await settled;
    expect(counts[0]).toBe(1);
    expect(counts.at(-1)).toBe(0);
  });

  it("enforces the running cap", async () => {
    const manager = new TerminalManager({ createSpill: () => null });
    const started = [];
    for (let i = 0; i < MAX_RUNNING; i++) {
      started.push(
        manager.start({ command: "sleep 30", title: `s${i}`, cwd }),
      );
    }
    expect(() =>
      manager.start({ command: "sleep 30", title: "overflow", cwd }),
    ).toThrow(/Already running/);
    await manager.kill(started.map((entry) => entry.id));
  });

  it("settles a spawn failure as failed instead of hanging", async () => {
    const once = settledOnce(() => manager);
    const manager = new TerminalManager(once.hooks);
    manager.start({ command: "true", title: "bad-cwd", cwd: "/nonexistent-dir-xyz" });
    const settled = await once.promise;
    expect(settled.status).toBe("failed");
  });
});
