import { describe, expect, it } from "vitest";
import {
  buildTitleInput,
  isTitleWorthy,
  MAX_TITLE_CHARS,
  sanitizeTitle,
} from "./src/title.ts";

describe("sanitizeTitle", () => {
  it("strips quotes, trailing punctuation, and extra lines", () => {
    expect(sanitizeTitle('"fix flaky watchdog test."')).toBe(
      "Fix flaky watchdog test",
    );
    expect(sanitizeTitle("workflow dashboard UI\nExplanation: because…")).toBe(
      "Workflow dashboard UI",
    );
    expect(sanitizeTitle("  spaced   out   title  ")).toBe("Spaced out title");
  });

  it("de-Title-Cases while keeping acronyms and mixed-case names", () => {
    expect(sanitizeTitle("Assess Webdev Tooling Gaps")).toBe(
      "Assess webdev tooling gaps",
    );
    expect(sanitizeTitle("Fix GitHub MCP Auth Flow")).toBe(
      "Fix GitHub MCP auth flow",
    );
  });

  it("clamps long output at a word boundary", () => {
    const long = "a very extremely unnecessarily verbose session title output";
    const title = sanitizeTitle(long)!;
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(title.endsWith(" ")).toBe(false);
    expect(long.startsWith(title.charAt(0).toLowerCase() + title.slice(1))).toBe(
      true,
    );
  });

  it("rejects empty output", () => {
    expect(sanitizeTitle("")).toBeUndefined();
    expect(sanitizeTitle('""')).toBeUndefined();
    expect(sanitizeTitle("   \n  ")).toBeUndefined();
  });
});

describe("isTitleWorthy", () => {
  it("skips commands, bash, and trivial input", () => {
    expect(isTitleWorthy("/workflows demo")).toBe(false);
    expect(isTitleWorthy("!git status")).toBe(false);
    expect(isTitleWorthy("hi")).toBe(false);
    expect(isTitleWorthy("fix the flaky watchdog test in child.ts")).toBe(true);
  });
});

describe("buildTitleInput", () => {
  it("clips very long first messages", () => {
    const input = buildTitleInput("x".repeat(5_000));
    expect(input.length).toBeLessThan(700);
    expect(input).toContain("Name this session");
  });
});
