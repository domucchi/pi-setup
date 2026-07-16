import { describe, expect, it } from "vitest";
import { buildResultMessage } from "./prompt.ts";
import { wrapText } from "./src/wrap.ts";

describe("buildResultMessage", () => {
  it("tells the model to fall back to plain text without a UI", () => {
    expect(buildResultMessage({ kind: "no-ui" })).toContain("plain text");
  });

  it("reports a dismissal without inventing an answer", () => {
    const message = buildResultMessage({ kind: "dismissed" });
    expect(message).toContain("dismissed");
    expect(message).toContain("Do not assume");
  });

  it("includes the selected option index and label", () => {
    expect(
      buildResultMessage({ kind: "selected", answer: "Use vitest", index: 2 }),
    ).toBe("The user selected option 2: Use vitest");
  });

  it("appends the note when the user attaches one", () => {
    expect(
      buildResultMessage({
        kind: "selected",
        answer: "Use vitest",
        index: 2,
        note: "but only for pure logic",
      }),
    ).toBe(
      "The user selected option 2: Use vitest\nThey attached a note qualifying this choice: but only for pure logic",
    );
  });

  it("omits the note line for empty notes", () => {
    expect(
      buildResultMessage({ kind: "selected", answer: "A", index: 1, note: "" }),
    ).toBe("The user selected option 1: A");
  });

  it("marks free-form answers as written by the user", () => {
    expect(
      buildResultMessage({ kind: "custom", answer: "neither, use X" }),
    ).toContain("wrote their own answer: neither, use X");
  });
});

describe("wrapText", () => {
  it("wraps long text at word boundaries", () => {
    expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
  });

  it("preserves explicit newlines and blank lines", () => {
    expect(wrapText("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });

  it("keeps an overlong single word on its own line", () => {
    expect(wrapText("supercalifragilistic", 5)).toEqual([
      "supercalifragilistic",
    ]);
  });
});
