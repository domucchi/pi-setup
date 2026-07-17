import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTokens,
  promptPreview,
  shortModel,
  windowSlice,
} from "./agent-format.ts";

describe("formatTokens", () => {
  it("scales through tok/k", () => {
    expect(formatTokens(842)).toBe("842 tok");
    expect(formatTokens(12_345)).toBe("12.3k tok");
    expect(formatTokens(12_000)).toBe("12k tok");
    expect(formatTokens(142_500)).toBe("143k tok");
  });

  it("rejects unusable values", () => {
    expect(formatTokens(undefined)).toBeUndefined();
    expect(formatTokens(Number.NaN)).toBeUndefined();
    expect(formatTokens(-5)).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatDuration(44_000)).toBe("44s");
    expect(formatDuration(337_000)).toBe("5m37s");
    expect(formatDuration(720_000)).toBe("12m");
  });
});

describe("shortModel", () => {
  it("strips the provider prefix", () => {
    expect(shortModel("openai-codex/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(shortModel("bare-id")).toBe("bare-id");
  });
});

describe("promptPreview", () => {
  it("clips long prompts and reports totals", () => {
    const preview = promptPreview("a\nb\nc\nd", 2);
    expect(preview).toEqual({ lines: ["a", "b"], totalLines: 4, clipped: true });
  });

  it("returns everything when maxLines is 0", () => {
    const preview = promptPreview("a\nb\nc", 0);
    expect(preview).toEqual({
      lines: ["a", "b", "c"],
      totalLines: 3,
      clipped: false,
    });
  });

  it("passes short prompts through", () => {
    expect(promptPreview("one line", 6)).toEqual({
      lines: ["one line"],
      totalLines: 1,
      clipped: false,
    });
  });

  it("handles missing prompts", () => {
    expect(promptPreview(undefined, 6)).toEqual({
      lines: [],
      totalLines: 0,
      clipped: false,
    });
  });
});

describe("windowSlice", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("returns everything when it fits", () => {
    expect(windowSlice(items, 3, 20)).toEqual({ items, offset: 0 });
  });

  it("centers the selection where possible", () => {
    const { items: slice, offset } = windowSlice(items, 5, 4);
    expect(offset).toBe(3);
    expect(slice).toEqual([3, 4, 5, 6]);
  });

  it("clamps at the edges", () => {
    expect(windowSlice(items, 0, 4).offset).toBe(0);
    expect(windowSlice(items, 9, 4).offset).toBe(6);
  });
});
