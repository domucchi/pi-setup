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

/** Parse persisted tool-result details back into a todo list (lenient). */
export function parseTodos(value: unknown): Todo[] {
  if (!Array.isArray(value)) return [];
  const todos: Todo[] = [];
  for (const item of value) {
    const record = item as { text?: unknown; status?: unknown };
    if (
      typeof record?.text === "string" &&
      (record.status === "pending" ||
        record.status === "in_progress" ||
        record.status === "completed")
    ) {
      todos.push({ text: record.text, status: record.status });
    }
  }
  return todos;
}

/** ANSI strikethrough (SGR 9) — supported by all modern terminals. */
export function strike(text: string): string {
  return `\x1b[9m${text}\x1b[29m`;
}

export interface TodoWindow {
  /** Leading completed items omitted from the visible work front. */
  doneCollapsed: number;
  shown: Todo[];
  /** Trailing open items omitted after the visible window. */
  hidden: number;
}

export function windowSummary(
  window: Pick<TodoWindow, "hidden" | "doneCollapsed">,
) {
  const parts: string[] = [];
  if (window.hidden > 0) parts.push(`+${window.hidden} more`);
  if (window.doneCollapsed > 0) {
    parts.push(`${window.doneCollapsed} completed`);
  }
  return parts.join(", ");
}

/**
 * Keep the work front visible within `max` rows. When the list overflows,
 * reserve the final row for combined metadata (`+N more, Y completed`), keep
 * the most recent completed item for continuity, then show open work.
 */
export function displayWindow(todos: Todo[], max: number): TodoWindow {
  if (todos.length <= max) return { doneCollapsed: 0, shown: todos, hidden: 0 };
  const firstOpen = todos.findIndex((t) => t.status !== "completed");
  const shownBudget = Math.max(1, max - 1);
  const start =
    firstOpen === -1
      ? Math.max(0, todos.length - shownBudget)
      : Math.max(0, firstOpen - 1);
  const shown = todos.slice(start, start + shownBudget);
  return {
    doneCollapsed: start,
    shown,
    hidden: todos.length - start - shown.length,
  };
}
