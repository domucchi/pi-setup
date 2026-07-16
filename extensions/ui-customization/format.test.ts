import { describe, expect, it } from "vitest";
import {
  formatContext,
  formatCost,
  formatModel,
  formatTokensShort,
  PI_LOGO,
} from "./src/format.ts";

describe("formatCost", () => {
  it("shows three decimals, handles zero/undefined", () => {
    expect(formatCost(0)).toBe("$0.000");
    expect(formatCost(0.006)).toBe("$0.006");
    expect(formatCost(1.2345)).toBe("$1.234");
    expect(formatCost(undefined as unknown as number)).toBe("$0.000");
  });
});

describe("formatTokensShort", () => {
  it("scales to k and m", () => {
    expect(formatTokensShort(157)).toBe("157");
    expect(formatTokensShort(372_000)).toBe("372k");
    expect(formatTokensShort(1_500_000)).toBe("1.5m");
  });
});

describe("formatContext", () => {
  it("one decimal under 10%, whole above, with window", () => {
    expect(formatContext(1.5, 372_000)).toBe("1.5% / 372k");
    expect(formatContext(42, 372_000)).toBe("42% / 372k");
  });
  it("handles unknown percent/window", () => {
    expect(formatContext(null, 0)).toBe("?% / ?");
  });
});

describe("formatModel", () => {
  it("joins provider and id, falls back cleanly", () => {
    expect(formatModel("openai-codex", "gpt-5.6-luna")).toBe("openai-codex/gpt-5.6-luna");
    expect(formatModel(undefined, "gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(formatModel(undefined, undefined)).toBe("no-model");
  });
});

describe("PI_LOGO", () => {
  it("is a 6-row block of equal width", () => {
    expect(PI_LOGO).toHaveLength(6);
    const widths = new Set(PI_LOGO.map((l) => [...l].length));
    expect(widths.size).toBe(1);
  });
});
