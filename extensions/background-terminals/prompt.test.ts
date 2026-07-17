import { describe, expect, it } from "vitest";
import { describeDuration, lastLines } from "./prompt.ts";

describe("describeDuration", () => {
  it("shows ms, seconds, and minutes with seconds", () => {
    const t = 1_000_000;
    expect(describeDuration(t, t + 500)).toBe("500ms");
    expect(describeDuration(t, t + 42_000)).toBe("42s");
    expect(describeDuration(t, t + 83_000)).toBe("1min 23s");
    expect(describeDuration(t, t + 120_000)).toBe("2min");
  });
});

describe("lastLines", () => {
  it("returns trailing lines, dropping the trailing newline blank", () => {
    expect(lastLines("a\nb\nc\n", 2)).toEqual(["b", "c"]);
    expect(lastLines("a\nb", 5)).toEqual(["a", "b"]);
    expect(lastLines("", 3)).toEqual([]);
  });
});
