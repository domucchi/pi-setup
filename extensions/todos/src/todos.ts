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

/** ANSI strikethrough (SGR 9) — supported by all modern terminals. */
export function strike(text: string): string {
  return `\x1b[9m${text}\x1b[29m`;
}

/**
 * Trim the display list to `max` lines: everything if it fits, else the
 * first `max` in given order plus an overflow marker count.
 */
export function displayWindow(
  todos: Todo[],
  max: number,
): { shown: Todo[]; hidden: number } {
  if (todos.length <= max) return { shown: todos, hidden: 0 };
  return { shown: todos.slice(0, max), hidden: todos.length - max };
}
