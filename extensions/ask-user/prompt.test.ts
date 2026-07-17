import { describe, expect, it } from "vitest";
import { buildResultMessage } from "./prompt.ts";
import {
  allAnswered,
  answerTexts,
  emptyAnswers,
  firstUnanswered,
  isAnswered,
  nextTarget,
  tabLabel,
  toggleSelection,
} from "./src/form.ts";
import { wrapText } from "./src/wrap.ts";

describe("buildResultMessage", () => {
  it("tells the model to fall back to plain text without a UI", () => {
    expect(buildResultMessage({ kind: "no-ui" })).toContain("plain text");
  });

  it("reports a dismissal without inventing answers", () => {
    const message = buildResultMessage({ kind: "dismissed" });
    expect(message).toContain("dismissed");
    expect(message).toContain("Do not assume");
  });

  it("reports a single selection with its note", () => {
    expect(
      buildResultMessage({
        kind: "answered",
        results: [
          {
            question: "Test runner?",
            answers: ["Use vitest"],
            wasCustom: false,
            note: "but only for pure logic",
          },
        ],
      }),
    ).toBe(
      "The user selected: Use vitest\nThey attached a note qualifying this choice: but only for pure logic",
    );
  });

  it("marks free-form answers as written by the user", () => {
    expect(
      buildResultMessage({
        kind: "answered",
        results: [
          { question: "Q", answers: ["neither, use X"], wasCustom: true },
        ],
      }),
    ).toContain("wrote their own answer: neither, use X");
  });

  it("numbers multi-question results with their answers", () => {
    const message = buildResultMessage({
      kind: "answered",
      results: [
        { question: "Coffee?", answers: ["Espresso"], wasCustom: false },
        {
          question: "Which to test?",
          answers: ["Preview", "Multi"],
          wasCustom: false,
        },
      ],
    });
    expect(message).toContain("1. Coffee?\n   → Espresso");
    expect(message).toContain("2. Which to test?\n   → Preview, Multi");
  });
});

describe("form state", () => {
  const question = {
    question: "Q?",
    options: [{ label: "A" }, { label: "B" }, { label: "C" }],
    multiSelect: true,
  };

  it("tracks answered state through selections and custom answers", () => {
    const answers = emptyAnswers(2);
    expect(isAnswered(answers[0])).toBe(false);
    answers[0] = toggleSelection(answers[0], 1);
    expect(isAnswered(answers[0])).toBe(true);
    answers[1] = { selected: [], custom: "my own" };
    expect(allAnswered(answers)).toBe(true);
  });

  it("toggles selections on and off, clearing custom text", () => {
    let a = { selected: [0], custom: "x" } as ReturnType<typeof toggleSelection>;
    a = toggleSelection(a, 2);
    expect(a.selected).toEqual([0, 2]);
    expect(a.custom).toBeUndefined();
    a = toggleSelection(a, 0);
    expect(a.selected).toEqual([2]);
  });

  it("advances to the next unanswered question, wrapping", () => {
    const answers = emptyAnswers(3);
    answers[1] = toggleSelection(answers[1], 0);
    expect(nextTarget(answers, 1)).toBe(2);
    answers[2] = toggleSelection(answers[2], 0);
    expect(nextTarget(answers, 2)).toBe(0);
    answers[0] = toggleSelection(answers[0], 0);
    expect(nextTarget(answers, 0)).toBe(3); // submit tab
    expect(firstUnanswered(answers)).toBeUndefined();
  });

  it("maps answers to option labels or the custom text", () => {
    expect(answerTexts(question, { selected: [0, 2] })).toEqual(["A", "C"]);
    expect(answerTexts(question, { selected: [], custom: "mine" })).toEqual([
      "mine",
    ]);
  });

  it("labels tabs from headers with Qn fallback", () => {
    expect(tabLabel({ ...question, header: "Coffee" }, 0)).toBe("Coffee");
    expect(tabLabel(question, 2)).toBe("Q3");
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
