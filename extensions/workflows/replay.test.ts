import { describe, expect, it } from "vitest";
import { createPrefixReplayer, type ReplayEntry } from "./src/replay.ts";

function entry(
  seq: number,
  outcome: ReplayEntry["outcome"] = { ok: true, output: `result-${seq}` },
): ReplayEntry {
  return {
    seq,
    promptHash: `prompt-${seq}`,
    optsHash: `opts-${seq}`,
    outcome,
  };
}

describe("createPrefixReplayer", () => {
  it("replays matching calls in sequence and closes permanently on mismatch", () => {
    const replay = createPrefixReplayer([entry(1), entry(2), entry(3)]);

    expect(
      replay.tryReplay({ seq: 1, promptHash: "prompt-1", optsHash: "opts-1" }),
    ).toEqual({ hit: true, outcome: { ok: true, output: "result-1" } });
    expect(
      replay.tryReplay({ seq: 2, promptHash: "changed", optsHash: "opts-2" }),
    ).toEqual({ hit: false });
    expect(
      replay.tryReplay({ seq: 3, promptHash: "prompt-3", optsHash: "opts-3" }),
    ).toEqual({ hit: false });
    expect(replay.replayedCount()).toBe(1);
    expect(replay.isOpen()).toBe(false);
  });

  it("preserves failed outcomes for sandbox null semantics", () => {
    const failed = { ok: false, output: "", error: "source failure" };
    const replay = createPrefixReplayer([entry(1, failed)]);

    const attempt = replay.tryReplay({
      seq: 1,
      promptHash: "prompt-1",
      optsHash: "opts-1",
    });
    expect(attempt).toEqual({ hit: true, outcome: failed });
    if (attempt.hit) {
      expect(attempt.outcome.ok).toBe(false);
      expect(attempt.outcome.output).toBe("");
      expect(attempt.outcome.structured).toBeUndefined();
    }
  });

  it("closes replay when the next prefix entry is absent", () => {
    const replay = createPrefixReplayer([entry(1)]);
    expect(
      replay.tryReplay({ seq: 1, promptHash: "prompt-1", optsHash: "opts-1" }).hit,
    ).toBe(true);
    expect(
      replay.tryReplay({ seq: 2, promptHash: "prompt-2", optsHash: "opts-2" }).hit,
    ).toBe(false);
    expect(replay.isOpen()).toBe(false);
  });
});
