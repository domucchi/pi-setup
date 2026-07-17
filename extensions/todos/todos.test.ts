import { describe, expect, it } from "vitest";
import { buildTodoResult } from "./prompt.ts";
import {
  allDone,
  displayWindow,
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
  it("passes small lists through and counts hidden overflow", () => {
    const todos = Array.from({ length: 12 }, (_, i) => todo("pending", `t${i}`));
    expect(displayWindow(todos.slice(0, 3), 10)).toEqual({
      shown: todos.slice(0, 3),
      hidden: 0,
    });
    const windowed = displayWindow(todos, 10);
    expect(windowed.shown).toHaveLength(10);
    expect(windowed.hidden).toBe(2);
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
