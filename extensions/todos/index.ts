/**
 * todos — a Claude Code-style todo list the model maintains via
 * todo_write (full-list replace). Rendered twice: as the tool result in
 * the chat, and as a live checklist widget above the input while work
 * is underway (all-done lists linger a minute, then clear).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { OverlayTheme } from "../shared/overlay.ts";
import {
  buildTodoResult,
  TODO_PARAMETER_DESCRIPTIONS,
  TODO_PROMPT_GUIDELINES,
  TODO_PROMPT_SNIPPET,
  TODO_WRITE_DESCRIPTION,
} from "./prompt.ts";
import {
  allDone,
  displayWindow,
  MAX_TODOS,
  strike,
  type Todo,
} from "./src/todos.ts";

const WIDGET_LINGER_MS = 60_000;
const WIDGET_TICK_MS = 5_000;
const WIDGET_MAX_LINES = 10;

/** One checklist line, CC-style: struck done, bold current, quiet pending. */
function todoLine(theme: OverlayTheme, todo: Todo): string {
  switch (todo.status) {
    case "completed":
      return ` ${theme.fg("success", "✓")} ${theme.fg("dim", strike(todo.text))}`;
    case "in_progress":
      return ` ${theme.fg("warning", "◆")} ${theme.fg("text", theme.bold(todo.text))}`;
    case "pending":
      return ` ${theme.fg("dim", "☐")} ${theme.fg("muted", todo.text)}`;
  }
}

export default function todos(pi: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;
  let list: Todo[] = [];
  let completedAt: number | undefined;
  let widgetVisible = false;
  let widgetTimer: ReturnType<typeof setInterval> | undefined;
  let nudgeWidget: (() => void) | undefined;

  const widgetLines = (theme: OverlayTheme, width: number): string[] => {
    const { shown, hidden } = displayWindow(list, WIDGET_MAX_LINES);
    const lines = shown.map((todo) =>
      truncateToWidth(todoLine(theme, todo), width),
    );
    if (hidden > 0) lines.push(theme.fg("dim", `   … +${hidden} more`));
    return lines;
  };

  // Visible while the list has an unfinished item; a fully-completed
  // list lingers so the finish is seen, then clears. Set ONCE per
  // visible spell (render pulls live state) to keep widget order stable.
  const updateWidget = () => {
    if (!currentCtx) return;
    const now = Date.now();
    const visible =
      list.length > 0 &&
      (!allDone(list) ||
        (completedAt !== undefined && now - completedAt <= WIDGET_LINGER_MS));
    if (!visible) {
      if (widgetVisible) currentCtx.ui.setWidget("todos", undefined);
      widgetVisible = false;
      nudgeWidget = undefined;
      if (widgetTimer) {
        clearInterval(widgetTimer);
        widgetTimer = undefined;
      }
      return;
    }
    if (!widgetTimer) {
      widgetTimer = setInterval(() => {
        updateWidget();
        nudgeWidget?.();
      }, WIDGET_TICK_MS);
    }
    if (widgetVisible) return;
    widgetVisible = true;
    currentCtx.ui.setWidget(
      "todos",
      (tui, theme) => {
        nudgeWidget = () => tui.requestRender();
        return {
          invalidate() {},
          render: (width: number) => widgetLines(theme, width),
        };
      },
      { placement: "aboveEditor" },
    );
  };

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    list = [];
    completedAt = undefined;
    updateWidget();
  });

  pi.on("session_shutdown", () => {
    currentCtx = undefined;
    list = [];
    if (widgetTimer) {
      clearInterval(widgetTimer);
      widgetTimer = undefined;
    }
    widgetVisible = false;
    nudgeWidget = undefined;
  });

  pi.registerTool({
    name: "todo_write",
    label: "Todos",
    description: TODO_WRITE_DESCRIPTION,
    promptSnippet: TODO_PROMPT_SNIPPET,
    promptGuidelines: TODO_PROMPT_GUIDELINES,
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          text: Type.String({ description: TODO_PARAMETER_DESCRIPTIONS.text }),
          status: Type.Union(
            [
              Type.Literal("pending"),
              Type.Literal("in_progress"),
              Type.Literal("completed"),
            ],
            { description: TODO_PARAMETER_DESCRIPTIONS.status },
          ),
        }),
        { maxItems: MAX_TODOS, description: TODO_PARAMETER_DESCRIPTIONS.todos },
      ),
    }),
    async execute(_id, params) {
      list = params.todos.map((t) => ({ text: t.text, status: t.status }));
      completedAt = allDone(list) ? Date.now() : undefined;
      updateWidget();
      return {
        content: [{ type: "text" as const, text: buildTodoResult(list) }],
        details: { todos: list },
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("todos")), 0, 0);
    },
    // The checklist itself is the useful rendering (like Claude Code).
    renderResult(result, _options, theme) {
      const stored = (result.details as { todos?: Todo[] } | undefined)?.todos;
      if (!stored || stored.length === 0) {
        return new Text(theme.fg("dim", "✓ todo list cleared"), 0, 0);
      }
      return new Text(stored.map((todo) => todoLine(theme, todo)).join("\n"), 0, 0);
    },
  });
}
