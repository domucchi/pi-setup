import { describe, expect, it } from "vitest";
import { buildTodoResult } from "./prompt.ts";
import {
  allDone,
  displayWindow,
  extraInProgress,
  strike,
  summarize,
  todoCounts,
  type Todo,
} from "./src/todos.ts";

const todo = (status: Todo["status"], text = "x"): Todo => ({ text, status });

describe("todoCounts / summarize", () => {
  it("counts buckets and summarizes only non-zero ones", () => {
    const todos = [
      todo("completed"),
      todo("in_progress"),
      todo("pending"),
      todo("pending"),
    ];
    expect(todoCounts(todos)).toEqual({
      total: 4,
      pending: 2,
      inProgress: 1,
      completed: 1,
    });
    expect(summarize(todos)).toBe("1 in progress · 2 pending · 1 done");
    expect(summarize([todo("completed")])).toBe("1 done");
    expect(summarize([])).toBe("empty");
  });
});

describe("allDone", () => {
  it("requires a non-empty fully-completed list", () => {
    expect(allDone([])).toBe(false);
    expect(allDone([todo("completed"), todo("pending")])).toBe(false);
    expect(allDone([todo("completed"), todo("completed")])).toBe(true);
  });
});

describe("displayWindow", () => {
  it("passes small lists through untouched", () => {
    const todos = [todo("completed"), todo("in_progress"), todo("pending")];
    expect(displayWindow(todos, 6)).toEqual({
      doneCollapsed: 0,
      shown: todos,
      hidden: 0,
    });
  });

  it("collapses done items but keeps the most recent one visible", () => {
    const todos = [
      todo("completed", "d1"),
      todo("completed", "d2"),
      todo("completed", "d3"),
      todo("in_progress", "current"),
      ...Array.from({ length: 6 }, (_, i) => todo("pending", `p${i}`)),
    ];
    const windowed = displayWindow(todos, 6);
    expect(windowed.doneCollapsed).toBe(2); // d1+d2 merged, d3 stays visible
    expect(windowed.shown[0].text).toBe("d3");
    expect(windowed.shown[1].text).toBe("current");
    expect(windowed.shown).toHaveLength(5); // 6 rows − 1 done-summary line
    expect(windowed.hidden).toBe(3);
  });

  it("shows the tail when everything is completed", () => {
    const todos = Array.from({ length: 10 }, (_, i) => todo("completed", `d${i}`));
    const windowed = displayWindow(todos, 6);
    expect(windowed.doneCollapsed).toBe(5);
    expect(windowed.shown[0].text).toBe("d5");
    expect(windowed.shown).toHaveLength(5);
    expect(windowed.hidden).toBe(0);
  });
});

describe("extraInProgress", () => {
  it("flags only lists with more than one in_progress item", () => {
    expect(extraInProgress([todo("in_progress"), todo("pending")])).toEqual([]);
    expect(
      extraInProgress([todo("in_progress", "a"), todo("in_progress", "b")]),
    ).toEqual(["a", "b"]);
    expect(extraInProgress([])).toEqual([]);
  });
});

describe("strike", () => {
  it("wraps text in SGR 9/29", () => {
    expect(strike("done")).toBe("\x1b[9mdone\x1b[29m");
  });
});

describe("buildTodoResult", () => {
  it("summarizes updates and clears", () => {
    expect(buildTodoResult([])).toBe("Todo list cleared.");
    expect(buildTodoResult([todo("in_progress")])).toBe(
      "Todo list updated — 1 in progress.",
    );
  });
});
