/**
 * subagents — delegate self-contained tasks to in-process pi children.
 *
 * Design: extensions/subagents/DESIGN.md. Roles come from markdown agent
 * files (agents/*.md, project .pi/agents trust-gated). Children keep
 * their session alive after finishing so subagent_send can follow up
 * with context intact. Results are delivered like background-terminal
 * completions: immediately when idle, else on agent_settled.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { renderCompactResult, resultText } from "../shared/compact-result.ts";
import { sortRunningFirst } from "../shared/agent-format.ts";
import type { OverlayTheme } from "../shared/overlay.ts";
import { showSubagentsDashboard } from "./dashboard.ts";
import { createDemoSubagents, demoSubagentsHost } from "./src/demo.ts";
import {
  buildAgentTypeError,
  buildCheckResult,
  buildCompletionMessage,
  buildListResult,
  buildSpawnResult,
  buildWaitResult,
  CANCEL_DESCRIPTION,
  CHECK_DESCRIPTION,
  describeStatus,
  LIST_DESCRIPTION,
  PARAMETER_DESCRIPTIONS,
  SEND_DESCRIPTION,
  SPAWN_DESCRIPTION,
  SPAWN_PROMPT_GUIDELINES,
  SPAWN_PROMPT_SNIPPET,
  WAIT_DESCRIPTION,
} from "./prompt.ts";
import { loadAgentDefinitions } from "./src/agents.ts";
import { createExternalChild } from "./src/backends/index.ts";
import {
  createChild,
  resolveChildTrust,
  resolveModel,
} from "./src/child.ts";
import {
  SubagentManager,
  type SubagentSnapshot,
  type SubagentStatus,
} from "./src/manager.ts";

const RESULT_MESSAGE_TYPE = "subagent-result";

interface CompletionDetails {
  id: string;
  title: string;
  status: SubagentStatus;
}

export default function subagents(pi: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;
  const pendingResults = new Map<string, SubagentSnapshot>();
  /** Ids whose current settle is already reported through a tool result. */
  const consumed = new Set<string>();

  // ---- Indicator UNDER the input: per-state counts with icons/colors.
  // Settled agents linger in the counts for a minute, then drop out (they
  // stay in /subagents); the widget hides once every bucket is empty.
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

  // One line builder for the real widget and the /subagents demo one.
  // The muted label column (aligned across the agents/terminals/workflows
  // widgets) is what tells the three strips apart at a glance.
  const widgetLine = (theme: OverlayTheme, counts: WidgetCounts) => {
    const parts: string[] = [];
    if (counts.running > 0) {
      parts.push(theme.fg("warning", `◆ ${counts.running} running`));
    }
    if (counts.done > 0) {
      parts.push(theme.fg("success", `✓ ${counts.done} done`));
    }
    if (counts.failed > 0) {
      parts.push(theme.fg("error", `✗ ${counts.failed} failed`));
    }
    parts.push(theme.fg("accent", "/subagents") + theme.fg("dim", " to manage"));
    return [
      ` ${theme.fg("muted", "agents".padEnd(10))} ${parts.join(theme.fg("dim", " · "))}`,
    ];
  };

  const widgetCounts = (): WidgetCounts => {
    const now = Date.now();
    const counts: WidgetCounts = { running: 0, done: 0, failed: 0 };
    for (const snapshot of manager.list()) {
      if (snapshot.status === "working") counts.running += 1;
      else if (
        snapshot.status !== "cancelled" &&
        snapshot.settledAt !== null &&
        now - snapshot.settledAt <= WIDGET_LINGER_MS
      ) {
        if (snapshot.status === "failed") counts.failed += 1;
        else counts.done += 1;
      }
    }
    return counts;
  };

  // The widget is set ONCE per visible spell (render() pulls fresh counts);
  // re-setting on every change would reorder it against other widgets. The
  // ticker re-renders so lingering entries expire without user activity.
  const updateWidget = () => {
    if (!currentCtx) return;
    const counts = widgetCounts();
    const visible = counts.running + counts.done + counts.failed > 0;
    if (!visible) {
      if (widgetVisible) currentCtx.ui.setWidget("subagents", undefined);
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
      "subagents",
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

  const deliver = (snapshot: SubagentSnapshot) => {
    pi.sendMessage(
      {
        customType: RESULT_MESSAGE_TYPE,
        content: buildCompletionMessage(snapshot),
        display: true,
        details: {
          id: snapshot.id,
          title: snapshot.title,
          status: snapshot.status,
        } satisfies CompletionDetails,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  const manager = new SubagentManager({
    createChild: async (options) => {
      const ctx = currentCtx;
      if (!ctx) throw new Error("Subagents require an active session.");
      const registry = ctx.modelRegistry;
      if (!registry) throw new Error("Model registry unavailable.");

      const projectTrusted = resolveChildTrust({
        parentCwd: ctx.cwd,
        childCwd: options.cwd,
        parentTrusted: ctx.isProjectTrusted(),
      });
      // Load roles from the CHILD's cwd with the child's resolved trust —
      // a child pointed at another project must see that project's roles.
      const definitions = loadAgentDefinitions({
        agentDir: getAgentDir(),
        cwd: options.cwd,
        projectTrusted,
      });
      const definition = definitions.get(options.agentType);
      if (!definition) {
        throw new Error(buildAgentTypeError(options.agentType, definitions));
      }

      if (definition.backend !== "pi") {
        // External runtimes (Claude Code / Codex) bring their own tools,
        // models, and permission systems; model hints are passed through
        // verbatim, never resolved against pi's registry.
        return createExternalChild(definition.backend, {
          cwd: options.cwd,
          model: options.model ?? definition.model,
          thinking: options.thinking ?? definition.thinking,
          appendSystemPrompt: definition.systemPrompt,
          sessionName: options.title,
          onEvent: options.onEvent,
        });
      }

      return createChild({
        cwd: options.cwd,
        projectTrusted,
        modelRegistry: registry,
        model: resolveModel(
          registry,
          options.model ?? definition.model,
          ctx.model,
        ),
        // Inherit the parent's thinking level unless the role or spawn
        // overrides it (documented in skills/subagents/SKILL.md).
        thinkingLevel:
          options.thinking ?? definition.thinking ?? pi.getThinkingLevel(),
        allowTools: definition.tools,
        appendSystemPrompt: definition.systemPrompt,
        sessionName: options.title,
        onEvent: options.onEvent,
      });
    },
    onWorkingCountChanged: updateWidget,
    onRunSettled: (snapshot, consumedByWaiter) => {
      if (consumedByWaiter || consumed.has(snapshot.id)) {
        consumed.delete(snapshot.id);
        return;
      }
      if (currentCtx?.isIdle()) {
        deliver(snapshot);
      } else {
        pendingResults.set(snapshot.id, snapshot);
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
  });

  pi.on("agent_settled", () => {
    for (const snapshot of pendingResults.values()) deliver(snapshot);
    pendingResults.clear();
  });

  pi.on("session_shutdown", async () => {
    currentCtx = undefined;
    pendingResults.clear();
    if (widgetTimer) {
      clearInterval(widgetTimer);
      widgetTimer = undefined;
    }
    widgetVisible = false;
    nudgeWidget = undefined;
    await manager.disposeAll();
  });

  // Completion follow-ups collapse to their header line; ctrl+o expands.
  pi.registerMessageRenderer<CompletionDetails>(
    RESULT_MESSAGE_TYPE,
    (message, options, theme) => {
      const ok = message.details?.status === "idle";
      const icon = ok ? theme.fg("success", "◆ ") : theme.fg("warning", "◆ ");
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
    name: "subagent_spawn",
    label: "Spawn Subagent",
    description: SPAWN_DESCRIPTION,
    promptSnippet: SPAWN_PROMPT_SNIPPET,
    promptGuidelines: SPAWN_PROMPT_GUIDELINES,
    parameters: Type.Object({
      prompt: Type.String({ description: PARAMETER_DESCRIPTIONS.prompt }),
      title: Type.String({ description: PARAMETER_DESCRIPTIONS.title }),
      agent_type: Type.Optional(
        Type.String({ description: PARAMETER_DESCRIPTIONS.agentType }),
      ),
      model: Type.Optional(
        Type.String({ description: PARAMETER_DESCRIPTIONS.model }),
      ),
      reasoning_effort: Type.Optional(
        Type.String({ description: PARAMETER_DESCRIPTIONS.reasoningEffort }),
      ),
      working_dir: Type.Optional(
        Type.String({ description: PARAMETER_DESCRIPTIONS.workingDir }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const snapshot = await manager.spawn({
        prompt: params.prompt,
        title: params.title,
        agentType: params.agent_type ?? "worker",
        model: params.model,
        thinking: params.reasoning_effort,
        cwd: params.working_dir ?? ctx.cwd,
      });
      return {
        content: [{ type: "text" as const, text: buildSpawnResult(snapshot) }],
        details: {
          id: snapshot.id,
          title: snapshot.title,
          agentType: snapshot.agentType,
          sessionFile: snapshot.sessionFile,
        },
      };
    },
  });

  pi.registerTool({
    name: "subagent_send",
    label: "Message Subagent",
    description: SEND_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({ description: PARAMETER_DESCRIPTIONS.sendId }),
      message: Type.String({ description: PARAMETER_DESCRIPTIONS.sendMessage }),
    }),
    async execute(_id, params) {
      const snapshot = await manager.send(params.id, params.message);
      consumed.delete(params.id);
      pendingResults.delete(params.id);
      const mode =
        snapshot.status === "working" ? "delivered to the running agent" : "started a new run";
      return {
        content: [
          {
            type: "text" as const,
            text: `Message ${mode} on ${snapshot.id}. You will be notified when it settles.`,
          },
        ],
        details: { id: snapshot.id, status: snapshot.status },
      };
    },
  });

  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for Subagents",
    description: WAIT_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        minItems: 1,
        maxItems: 16,
        description: PARAMETER_DESCRIPTIONS.waitIds,
      }),
    }),
    async execute(_id, params, _signal, onUpdate) {
      onUpdate?.({
        content: [
          { type: "text" as const, text: `Waiting for ${params.ids.join(", ")}…` },
        ],
        details: {},
      });
      const snapshots = await manager.wait(params.ids);
      for (const snapshot of snapshots) {
        consumed.add(snapshot.id);
        pendingResults.delete(snapshot.id);
      }
      return {
        content: [{ type: "text" as const, text: buildWaitResult(snapshots) }],
        details: { ids: params.ids },
      };
    },
    // Full reports are for the model; the human gets the report headers
    // (ctrl+o expands, /subagents has the full dashboard).
    renderResult(result, options, theme) {
      const text = resultText(result);
      const headers = text
        .split("\n")
        .filter((line) => line.startsWith("## "))
        .map((line) => line.slice(3));
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        summary: `→ ${headers.length || "no"} report${headers.length === 1 ? "" : "s"}`,
        fullText: text,
        previewLines: headers,
      });
    },
  });

  pi.registerTool({
    name: "subagent_check",
    label: "Check Subagent",
    description: CHECK_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({ description: PARAMETER_DESCRIPTIONS.checkId }),
    }),
    async execute(_id, params) {
      const snapshot = manager.get(params.id);
      if (!snapshot) {
        throw new Error(`No subagent "${params.id}". Use subagent_list to see all.`);
      }
      if (snapshot.status !== "working") {
        consumed.add(snapshot.id);
        pendingResults.delete(snapshot.id);
      }
      return {
        content: [{ type: "text" as const, text: buildCheckResult(snapshot) }],
        details: { id: snapshot.id, status: snapshot.status },
      };
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: CANCEL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        minItems: 1,
        description: PARAMETER_DESCRIPTIONS.cancelIds,
      }),
    }),
    async execute(_id, params) {
      for (const id of params.ids) {
        consumed.add(id);
        pendingResults.delete(id);
      }
      const snapshots = await manager.cancel(params.ids);
      const text =
        snapshots.length === 0
          ? "No matching subagents."
          : snapshots.map((s) => `${s.id}: ${describeStatus(s)}`).join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { ids: params.ids },
      };
    },
  });

  pi.registerTool({
    name: "subagent_list",
    label: "List Subagents",
    description: LIST_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const snapshots = manager.list();
      return {
        content: [{ type: "text" as const, text: buildListResult(snapshots) }],
        details: { count: snapshots.length },
      };
    },
  });

  let demoWidgetTimer: ReturnType<typeof setTimeout> | undefined;

  pi.registerCommand("subagents", {
    description: "Inspect subagents (`/subagents demo` previews the UI)",
    handler: async (args, ctx) => {
      if (args?.trim() === "demo") {
        // Fixture-backed preview: same dashboard + widget code paths,
        // no real children. The widget lingers so it can be seen under
        // the input after the overlay closes.
        if (demoWidgetTimer) clearTimeout(demoWidgetTimer);
        ctx.ui.setWidget(
          "subagents-demo",
          (_tui, theme) => ({
            invalidate() {},
            render: () => widgetLine(theme, { running: 1, done: 2, failed: 1 }),
          }),
          { placement: "belowEditor" },
        );
        try {
          await showSubagentsDashboard(
            ctx,
            demoSubagentsHost(createDemoSubagents(Date.now())),
          );
        } finally {
          ctx.ui.notify("demo widget below the input clears in 20s", "info");
          demoWidgetTimer = setTimeout(
            () => currentCtx?.ui.setWidget("subagents-demo", undefined),
            20_000,
          );
        }
        return;
      }
      await showSubagentsDashboard(ctx, {
        list: () =>
          sortRunningFirst(
            manager.list(),
            (s) => s.status === "working",
            (s) => s.startedAt,
          ),
        transcriptTail: (id, lines) => manager.transcriptTail(id, lines),
        cancel: (id) => {
          // Mirror the subagent_cancel tool: suppress the pending
          // completion follow-up for an agent the user kills by hand.
          consumed.add(id);
          pendingResults.delete(id);
          void manager.cancel([id]).catch(() => {});
        },
      });
    },
  });
}
