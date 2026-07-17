/**
 * background-terminals — the model runs long-lived processes without
 * blocking its turn. No stdin by design; output is ring-buffered in
 * memory (2MB/stream) with full logs spilled to owner-only temp files.
 *
 * Exit results are delivered as a follow-up message: immediately when
 * the agent is idle, otherwise once the current run settles. Terminals
 * killed via bg_kill (or already inspected after settling) are not
 * re-announced. Everything is ephemeral: session switch kills all.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { sortRunningFirst } from "../shared/agent-format.ts";
import type { OverlayTheme } from "../shared/overlay.ts";
import { showTerminalsDashboard } from "./dashboard.ts";
import { createDemoTerminals, demoTerminalsHost } from "./src/demo.ts";
import {
  BG_KILL_DESCRIPTION,
  BG_LIST_DESCRIPTION,
  BG_PARAMETER_DESCRIPTIONS,
  BG_START_DESCRIPTION,
  BG_STATUS_DESCRIPTION,
  buildCompletionMessage,
  buildListResult,
  buildStartResult,
  buildStatusResult,
  describeOutcome,
} from "./prompt.ts";
import {
  TerminalManager,
  type TerminalEntry,
  type TerminalStatus,
} from "./src/manager.ts";

const RESULT_MESSAGE_TYPE = "bg-terminal-result";

interface CompletionDetails {
  id: string;
  title: string;
  status: TerminalStatus;
  exitCode: number | null;
}

export default function backgroundTerminals(pi: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;
  /** Settled-but-unannounced terminals, keyed by id. */
  const pendingResults = new Map<string, TerminalEntry>();
  /** Ids whose settle is already reported through a tool result. */
  const consumed = new Set<string>();

  // ---- Indicator UNDER the input (matching subagents/workflows):
  // per-state counts; settled terminals linger for a minute, then drop
  // (they stay in /ps). Killed ones are excluded — the user knows.
  const WIDGET_LINGER_MS = 60_000;
  const WIDGET_TICK_MS = 5_000;
  let widgetVisible = false;
  let widgetTimer: ReturnType<typeof setInterval> | undefined;
  let nudgeWidget: (() => void) | undefined;

  interface WidgetCounts {
    running: number;
    done: number;
    failed: number;
  }

  // The muted label column (aligned across the agents/terminals/workflows
  // widgets) is what tells the three strips apart at a glance.
  const widgetLine = (theme: OverlayTheme, counts: WidgetCounts) => {
    const parts: string[] = [];
    if (counts.running > 0) {
      parts.push(theme.fg("warning", `◆ ${counts.running} running`));
    }
    if (counts.done > 0) parts.push(theme.fg("success", `✓ ${counts.done} done`));
    if (counts.failed > 0) {
      parts.push(theme.fg("error", `✗ ${counts.failed} failed`));
    }
    parts.push(theme.fg("accent", "/ps") + theme.fg("dim", " to manage"));
    return [
      ` ${theme.fg("muted", "terminals".padEnd(10))} ${parts.join(theme.fg("dim", " · "))}`,
    ];
  };

  const widgetCounts = (): WidgetCounts => {
    const now = Date.now();
    const counts: WidgetCounts = { running: 0, done: 0, failed: 0 };
    for (const entry of manager.list()) {
      if (entry.status === "running") counts.running += 1;
      else if (
        entry.status !== "killed" &&
        entry.settledAt !== null &&
        now - entry.settledAt <= WIDGET_LINGER_MS
      ) {
        if (entry.status === "failed") counts.failed += 1;
        else counts.done += 1;
      }
    }
    return counts;
  };

  // Set ONCE per visible spell (render() pulls live counts); re-setting
  // on each change would reorder widgets. Ticker expires lingerers.
  const updateWidget = () => {
    if (!currentCtx) return;
    const counts = widgetCounts();
    const visible = counts.running + counts.done + counts.failed > 0;
    if (!visible) {
      if (widgetVisible) currentCtx.ui.setWidget("background-terminals", undefined);
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
      "background-terminals",
      (tui, theme) => {
        nudgeWidget = () => tui.requestRender();
        return {
          invalidate() {},
          render: () => widgetLine(theme, widgetCounts()),
        };
      },
      { placement: "belowEditor" },
    );
  };

  const deliver = (entry: TerminalEntry) => {
    pi.sendMessage(
      {
        customType: RESULT_MESSAGE_TYPE,
        content: buildCompletionMessage(entry),
        display: true,
        details: {
          id: entry.id,
          title: entry.title,
          status: entry.status,
          exitCode: entry.exitCode,
        } satisfies CompletionDetails,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  const flushPending = () => {
    for (const entry of pendingResults.values()) deliver(entry);
    pendingResults.clear();
  };

  const manager = new TerminalManager({
    onRunningCountChanged: updateWidget,
    onSettled: (entry) => {
      if (consumed.has(entry.id)) return;
      if (currentCtx?.isIdle()) {
        deliver(entry);
      } else {
        pendingResults.set(entry.id, entry);
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
  });

  pi.on("agent_settled", () => {
    flushPending();
  });

  pi.on("session_shutdown", () => {
    currentCtx = undefined;
    pendingResults.clear();
    if (widgetTimer) {
      clearInterval(widgetTimer);
      widgetTimer = undefined;
    }
    widgetVisible = false;
    nudgeWidget = undefined;
    manager.disposeAll();
  });

  // Exit follow-ups collapse to their header line; ctrl+o expands.
  pi.registerMessageRenderer<CompletionDetails>(
    RESULT_MESSAGE_TYPE,
    (message, options, theme) => {
      const details = message.details;
      const ok = details?.status === "done";
      const icon = ok ? theme.fg("success", "✓ ") : theme.fg("warning", "✗ ");
      const text =
        typeof message.content === "string"
          ? message.content
          : (message.content?.find((c) => c.type === "text") as
              | { text: string }
              | undefined)?.text ?? "";
      if (options.expanded) {
        return new Text(icon + theme.fg("text", text), 0, 0);
      }
      const [first = "", ...rest] = text.split("\n");
      const more = rest.some((line) => line.trim() !== "");
      return new Text(
        icon + theme.fg("text", first) + (more ? theme.fg("dim", " …") : ""),
        0,
        0,
      );
    },
  );

  pi.registerTool({
    name: "bg_start",
    label: "Background Start",
    description: BG_START_DESCRIPTION,
    parameters: Type.Object({
      command: Type.String({ description: BG_PARAMETER_DESCRIPTIONS.command }),
      title: Type.String({ description: BG_PARAMETER_DESCRIPTIONS.title }),
      working_dir: Type.Optional(
        Type.String({ description: BG_PARAMETER_DESCRIPTIONS.workingDir }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const entry = manager.start({
        command: params.command,
        title: params.title,
        cwd: params.working_dir ?? ctx.cwd,
      });
      return {
        content: [{ type: "text" as const, text: buildStartResult(entry) }],
        details: { id: entry.id, title: entry.title, status: entry.status },
      };
    },
  });

  pi.registerTool({
    name: "bg_status",
    label: "Background Status",
    description: BG_STATUS_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({ description: BG_PARAMETER_DESCRIPTIONS.statusId }),
    }),
    async execute(_id, params) {
      const entry = manager.get(params.id);
      if (!entry) {
        throw new Error(
          `No background terminal "${params.id}". Use bg_list to see all terminals.`,
        );
      }
      if (entry.status !== "running") {
        // The model has now seen the outcome; no follow-up announcement.
        consumed.add(entry.id);
        pendingResults.delete(entry.id);
      }
      return {
        content: [{ type: "text" as const, text: buildStatusResult(entry) }],
        details: { id: entry.id, title: entry.title, status: entry.status },
      };
    },
  });

  pi.registerTool({
    name: "bg_list",
    label: "Background List",
    description: BG_LIST_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const entries = manager.list();
      return {
        content: [{ type: "text" as const, text: buildListResult(entries) }],
        details: { count: entries.length },
      };
    },
  });

  pi.registerTool({
    name: "bg_kill",
    label: "Background Kill",
    description: BG_KILL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        minItems: 1,
        description: BG_PARAMETER_DESCRIPTIONS.killIds,
      }),
    }),
    async execute(_id, params) {
      for (const id of params.ids) {
        consumed.add(id);
        pendingResults.delete(id);
      }
      const settled = await manager.kill(params.ids);
      const text =
        settled.length === 0
          ? "No matching running terminals."
          : settled
              .map((entry) => `${entry.id}: ${describeOutcome(entry)}`)
              .join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { ids: params.ids },
      };
    },
  });

  let demoWidgetTimer: ReturnType<typeof setTimeout> | undefined;

  pi.registerCommand("ps", {
    description: "Inspect background terminals (`/ps demo` previews the UI)",
    handler: async (args, ctx) => {
      if (args?.trim() === "demo") {
        // Fixture-backed preview: same dashboard + widget code paths, no
        // real processes. The widget lingers so it can be seen under the
        // input after the overlay closes.
        if (demoWidgetTimer) clearTimeout(demoWidgetTimer);
        ctx.ui.setWidget(
          "background-terminals-demo",
          (_tui, theme) => ({
            invalidate() {},
            render: () => widgetLine(theme, { running: 1, done: 1, failed: 1 }),
          }),
          { placement: "belowEditor" },
        );
        try {
          await showTerminalsDashboard(
            ctx,
            demoTerminalsHost(createDemoTerminals(Date.now())),
          );
        } finally {
          ctx.ui.notify("demo widget below the input clears in 20s", "info");
          demoWidgetTimer = setTimeout(
            () => currentCtx?.ui.setWidget("background-terminals-demo", undefined),
            20_000,
          );
        }
        return;
      }
      await showTerminalsDashboard(ctx, {
        list: () =>
          sortRunningFirst(
            manager.list(),
            (e) => e.status === "running",
            (e) => (e.status === "running" ? e.startedAt : (e.settledAt ?? e.startedAt)),
          ),
        kill: (id) => {
          // Mirror bg_kill: a terminal the user kills by hand should not
          // be re-announced as a completion follow-up.
          consumed.add(id);
          pendingResults.delete(id);
          void manager.kill([id]).catch(() => {});
        },
      });
    },
  });
}
