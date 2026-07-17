/** All model-facing text for the todos extension. */

import { MAX_TODOS, summarize, type Todo } from "./src/todos.ts";

export const TODO_WRITE_DESCRIPTION =
  `Maintain your todo list for the current task (up to ${MAX_TODOS} items). ` +
  "Each call REPLACES the whole list — pass every item with its current status " +
  "(pending | in_progress | completed). The list is shown to the user above their " +
  "input, so keep item texts short and outcome-shaped. " +
  "Use it for multi-step work (3+ steps): mark a step in_progress right before " +
  "starting it (only one at a time), completed immediately when it is done. " +
  "Skip it for trivial single-step tasks. Pass an empty list to clear it.";

export const TODO_PROMPT_SNIPPET =
  "Track multi-step work with a user-visible todo list (todo_write).";

export const TODO_PROMPT_GUIDELINES = [
  "For any task with 3+ distinct steps, maintain a todo list via todo_write: one item in_progress at a time, marked completed immediately when done.",
  "Rewrite the full list on every todo_write call; clear it (todos: []) when the plan becomes obsolete.",
];

export const TODO_PARAMETER_DESCRIPTIONS = {
  todos: `The complete todo list (replaces the previous one, max ${MAX_TODOS} items).`,
  text: "Short, outcome-shaped item text (e.g. 'Add workflow_status tool').",
  status: "pending | in_progress | completed.",
};

/** Tool-result text confirming the update. */
export function buildTodoResult(todos: Todo[]): string {
  if (todos.length === 0) return "Todo list cleared.";
  return `Todo list updated — ${summarize(todos)}.`;
}
