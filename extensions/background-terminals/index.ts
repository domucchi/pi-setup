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
import { Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  BG_KILL_DESCRIPTION,
  BG_LIST_DESCRIPTION,
  BG_PARAMETER_DESCRIPTIONS,
  BG_START_DESCRIPTION,
  BG_START_PROMPT_GUIDELINES,
  BG_START_PROMPT_SNIPPET,
  BG_STATUS_DESCRIPTION,
  buildCompletionMessage,
  buildListResult,
  buildPsDetailLines,
  buildPsLabel,
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
  let lastWidgetCount = 0;
  /** Settled-but-unannounced terminals, keyed by id. */
  const pendingResults = new Map<string, TerminalEntry>();
  /** Ids whose settle is already reported through a tool result. */
  const consumed = new Set<string>();

  const updateWidget = (count: number) => {
    if (!currentCtx || count === lastWidgetCount) return;
    lastWidgetCount = count;
    currentCtx.ui.setWidget(
      "background-terminals",
      count > 0
        ? [
            ` ● ${count} background terminal${count === 1 ? "" : "s"} running · /ps to inspect`,
          ]
        : undefined,
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
    manager.disposeAll();
  });

  pi.registerMessageRenderer<CompletionDetails>(
    RESULT_MESSAGE_TYPE,
    (message, _options, theme) => {
      const details = message.details;
      const ok = details?.status === "done";
      const icon = ok ? theme.fg("success", "✓ ") : theme.fg("warning", "✗ ");
      const text =
        typeof message.content === "string"
          ? message.content
          : (message.content?.find((c) => c.type === "text") as
              | { text: string }
              | undefined)?.text ?? "";
      return new Text(icon + theme.fg("text", text), 0, 0);
    },
  );

  pi.registerTool({
    name: "bg_start",
    label: "Background Start",
    description: BG_START_DESCRIPTION,
    promptSnippet: BG_START_PROMPT_SNIPPET,
    promptGuidelines: BG_START_PROMPT_GUIDELINES,
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

  pi.registerCommand("ps", {
    description: "Inspect background terminals",
    handler: async (_args, ctx) => {
      // Loop: picker → detail → back to picker, until Esc on the picker.
      for (;;) {
        const entries = manager.list();
        if (entries.length === 0) {
          ctx.ui.notify("No background terminals", "info");
          return;
        }
        const labels = entries.map(buildPsLabel);
        const picked = await ctx.ui.select("Background terminals:", labels);
        if (picked === undefined) return;
        const entry = entries[labels.indexOf(picked)];
        if (!entry) return;

        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          const interval = setInterval(() => tui.requestRender(), 1_000);
          return {
            render: (width: number) => {
              const lines = buildPsDetailLines(
                manager.get(entry.id) ?? entry,
              ).map((line) => truncateToWidth(` ${line}`, width));
              lines.push("");
              lines.push(
                truncateToWidth(
                  theme.fg("dim", " Esc back to list"),
                  width,
                ),
              );
              return lines;
            },
            invalidate: () => {},
            handleInput: (data: string) => {
              if (
                matchesKey(data, Key.escape) ||
                matchesKey(data, Key.enter) ||
                data === "q"
              ) {
                done(undefined);
              }
            },
            dispose: () => clearInterval(interval),
          };
        });
      }
    },
  });
}
