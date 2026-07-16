import { describe, expect, it } from "vitest";
import { makeRefreshCoordinator } from "./src/coordinator.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("makeRefreshCoordinator", () => {
  it("serializes run() tasks in order", async () => {
    const coordinator = makeRefreshCoordinator();
    const order: number[] = [];
    const gate = deferred();

    const first = coordinator.run(async () => {
      await gate.promise;
      order.push(1);
    });
    const second = coordinator.run(async () => {
      order.push(2);
    });

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it("drops runIfIdle() while busy", async () => {
    const coordinator = makeRefreshCoordinator();
    const gate = deferred();
    let idleRuns = 0;

    const busy = coordinator.run(() => gate.promise);
    await coordinator.runIfIdle(async () => {
      idleRuns += 1;
    });
    expect(idleRuns).toBe(0);

    gate.resolve();
    await busy;
    await coordinator.runIfIdle(async () => {
      idleRuns += 1;
    });
    expect(idleRuns).toBe(1);
  });

  it("recovers after a task rejects", async () => {
    const coordinator = makeRefreshCoordinator();

    await expect(
      coordinator.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(coordinator.isIdle()).toBe(true);
    let ran = false;
    await coordinator.runIfIdle(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
