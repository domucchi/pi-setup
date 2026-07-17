/** Pure logic for the todo list (testable). */

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface Todo {
  text: string;
  status: TodoStatus;
}

export const MAX_TODOS = 20;

export interface TodoCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

export function todoCounts(todos: Todo[]): TodoCounts {
  const counts: TodoCounts = {
    total: todos.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
  };
  for (const todo of todos) {
    if (todo.status === "pending") counts.pending += 1;
    else if (todo.status === "in_progress") counts.inProgress += 1;
    else counts.completed += 1;
  }
  return counts;
}

export function allDone(todos: Todo[]): boolean {
  return todos.length > 0 && todos.every((t) => t.status === "completed");
}

/** "1 in progress · 2 pending · 3 done" (only non-zero buckets). */
export function summarize(todos: Todo[]): string {
  const counts = todoCounts(todos);
  const parts: string[] = [];
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.completed > 0) parts.push(`${counts.completed} done`);
  return parts.length > 0 ? parts.join(" · ") : "empty";
}

/**
 * Texts of items violating the one-in_progress invariant (empty when
 * valid). Enforced in the tool, not just the prompt — a rejected call
 * corrects the model immediately.
 */
export function extraInProgress(todos: Todo[]): string[] {
  const active = todos.filter((t) => t.status === "in_progress");
  return active.length > 1 ? active.map((t) => t.text) : [];
}

/** ANSI strikethrough (SGR 9) — supported by all modern terminals. */
export function strike(text: string): string {
  return `\x1b[9m${text}\x1b[29m`;
}

export interface TodoWindow {
  /** Leading completed items collapsed into one "✓ N done" line. */
  doneCollapsed: number;
  shown: Todo[];
  /** Trailing items beyond the cap ("… +N more"). */
  hidden: number;
}

/**
 * Trim the display list to ~`max` rows while keeping the WORK FRONT
 * visible: leading completed items collapse into a single summary line
 * (they'd otherwise push the in_progress item off the cap) — except the
 * most recent one, which stays visible struck-through for continuity —
 * then the list from the first open item forward, then an overflow count.
 */
export function displayWindow(todos: Todo[], max: number): TodoWindow {
  if (todos.length <= max) return { doneCollapsed: 0, shown: todos, hidden: 0 };
  const firstOpen = todos.findIndex((t) => t.status !== "completed");
  // Keep one completed item visible above the front; all-done shows the tail.
  const start =
    firstOpen === -1
      ? Math.max(1, todos.length - (max - 1))
      : Math.max(0, firstOpen - 1);
  const budget = Math.max(1, max - (start > 0 ? 1 : 0));
  const shown = todos.slice(start, start + budget);
  return {
    doneCollapsed: start,
    shown,
    hidden: todos.length - start - shown.length,
  };
}
