import { describe, expect, it } from "vitest";
import { firstResponseWatchdogExpired } from "./src/child.ts";

describe("firstResponseWatchdogExpired", () => {
  it("fires when the run has not settled and no response was seen", () => {
    expect(
      firstResponseWatchdogExpired({ settled: false, firstResponseSeen: false }),
    ).toBe(true);
  });

  it("does not fire once a real response has arrived", () => {
    // Regression: a stalled provider keeps isStreaming true for the whole
    // run, so the guard must key on firstResponseSeen, not streaming state.
    expect(
      firstResponseWatchdogExpired({ settled: false, firstResponseSeen: true }),
    ).toBe(false);
  });

  it("does not fire after the run already settled", () => {
    expect(
      firstResponseWatchdogExpired({ settled: true, firstResponseSeen: false }),
    ).toBe(false);
  });
});
