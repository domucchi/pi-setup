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
  extraInProgress,
  MAX_TODOS,
  parseTodos,
  strike,
  summarize,
  type Todo,
} from "./src/todos.ts";

const WIDGET_LINGER_MS = 60_000;
const WIDGET_TICK_MS = 5_000;
const WIDGET_MAX_LINES = 6;

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
    const { doneCollapsed, shown, hidden } = displayWindow(list, WIDGET_MAX_LINES);
    const lines: string[] = [];
    if (doneCollapsed > 0) {
      lines.push(
        ` ${theme.fg("success", "✓")} ${theme.fg("dim", `+${doneCollapsed} done`)}`,
      );
    }
    for (const todo of shown) {
      lines.push(truncateToWidth(todoLine(theme, todo), width));
    }
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

  // A resumed session gets its list back from the LAST todo_write tool
  // result on the branch — tool results already persist in the session
  // file, so no extra storage is needed and the widget matches what the
  // model believes its list to be.
  const rehydrate = (ctx: ExtensionContext): Todo[] => {
    try {
      const entries = ctx.sessionManager.getBranch();
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.type !== "message") continue;
        const message = entry.message as {
          role?: string;
          toolName?: string;
          details?: { todos?: unknown };
        };
        if (message.role !== "toolResult" || message.toolName !== "todo_write") {
          continue;
        }
        return parseTodos(message.details?.todos);
      }
    } catch {
      // Session not readable yet — start empty.
    }
    return [];
  };

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    list = rehydrate(ctx);
    // A fully-done list should not reappear on resume: mark it already
    // past its linger window instead of restarting the countdown.
    completedAt = allDone(list) ? 0 : undefined;
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
      const extra = extraInProgress(params.todos);
      if (extra.length > 0) {
        throw new Error(
          `Only one todo may be in_progress at a time (got ${extra.length}: ${extra
            .map((t) => `"${t}"`)
            .join(", ")}). Mark the others pending or completed and retry.`,
        );
      }
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
    // The live checklist sits above the input; the tool result only
    // needs a summary line (ctrl+o still shows the full list).
    renderResult(result, options, theme) {
      const stored = (result.details as { todos?: Todo[] } | undefined)?.todos;
      if (!stored || stored.length === 0) {
        return new Text(theme.fg("dim", "✓ todo list cleared"), 0, 0);
      }
      if (options.expanded) {
        return new Text(
          stored.map((todo) => todoLine(theme, todo)).join("\n"),
          0,
          0,
        );
      }
      return new Text(theme.fg("dim", `→ ${summarize(stored)}`), 0, 0);
    },
  });
}
