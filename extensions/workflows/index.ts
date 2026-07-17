/**
 * workflows — model-authored orchestration scripts over sandboxed
 * execution. Design: extensions/workflows/DESIGN.md. The script runs in
 * a permission-restricted Node child (src/sandbox*), agents run through
 * subagents' createChild with in-memory sessions (src/runner), and
 * every run leaves a rehydratable audit trail + replay journal on disk
 * (src/artifacts).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  previewOf,
  renderCompactResult,
  resultText,
} from "../shared/compact-result.ts";
import { sortRunningFirst } from "../shared/agent-format.ts";
import type { OverlayTheme } from "../shared/overlay.ts";
import { showWorkflowsDashboard, type RunView } from "./dashboard.ts";
import { createDemoRuns, demoWorkflowsHost } from "./src/demo.ts";
import { statusColorKey, statusWord } from "./src/view.ts";
import {
  buildBackgroundFailureMessage,
  buildBackgroundStartMessage,
  buildRunResult,
  buildWorkflowStatus,
  PARAMETER_DESCRIPTIONS,
  STATUS_PARAMETER_DESCRIPTIONS,
  WORKFLOW_STATUS_DESCRIPTION,
  WORKFLOW_DESCRIPTION,
} from "./prompt.ts";
import {
  createRunStore,
  hashForJournal,
  loadResumeSource,
  loadSessionRunsFromDisk,
  newRunId,
  normalizeWorkflowCwd,
  type RunRecord,
} from "./src/artifacts.ts";
import { extractMeta, type WorkflowPhase } from "./src/meta.ts";
import { resolveNamedWorkflow } from "./src/named.ts";
import { createPrefixReplayer, type ReplayEntry } from "./src/replay.ts";
import { createAgentRunner, type RunnerEvent } from "./src/runner.ts";
import { runWorkflowSandbox, type SandboxResult } from "./src/sandbox.ts";
import { referencedWorkflowRunIds } from "./src/session.ts";

const MAX_AGENT_CALLS = 32;
const MAX_AGENT_ACTIVITY = 8;
const RESULT_MESSAGE_TYPE = "workflow-result";

export interface ActiveAgent {
  seq: number;
  label: string;
  phase?: string;
  state: "running" | "ok" | "failed";
  prompt?: string;
  agentType?: string;
  model?: string;
  tokens?: number;
  contextWindow?: number;
  toolCalls?: number;
  /** Recent tool-call previews, newest last. */
  activity: string[];
  startedAt: number;
  error?: string;
  durationMs?: number;
  /** Head of the agent's return value (full text in the run's artifacts). */
  output?: string;
}

export interface ActiveRun {
  record: RunRecord;
  dir: string;
  phases?: WorkflowPhase[];
  currentPhase?: string;
  agents: Map<number, ActiveAgent>;
  logs: string[];
  abort: AbortController;
  /** Loaded from disk rather than started by this extension instance. */
  rehydrated?: boolean;
}

export default function workflows(pi: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;
  let shuttingDown = false;
  const activeRuns = new Map<string, ActiveRun>();
  const pendingResults = new Map<string, string>();
  const liveTasks = new Set<Promise<unknown>>();

  const trackTask = <T>(task: Promise<T>) => {
    liveTasks.add(task);
    void task.then(
      () => liveTasks.delete(task),
      () => liveTasks.delete(task),
    );
    return task;
  };

  const sendResult = (runId: string, text: string) => {
    pi.sendMessage(
      { customType: RESULT_MESSAGE_TYPE, content: text, display: true, details: { runId } },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  /** Deliver a background result now if idle, else on the next agent_settled. */
  const deliverOrQueue = (runId: string, text: string) => {
    if (shuttingDown) return;
    if (currentCtx?.isIdle()) sendResult(runId, text);
    else pendingResults.set(runId, text);
  };

  // ---- Indicator UNDER the input: one line per run with per-state agent
  // counts; settled runs linger for a minute with their outcome, then drop
  // (they stay in /workflows). Hidden once nothing is running or lingering.
  const WIDGET_LINGER_MS = 60_000;
  const WIDGET_TICK_MS = 5_000;
  let widgetVisible = false;
  let widgetTimer: ReturnType<typeof setInterval> | undefined;
  let nudgeWidget: (() => void) | undefined;

  interface WidgetRun {
    name: string;
    phase?: string;
    status: RunRecord["status"];
    running: number;
    done: number;
    failed: number;
  }

  // One line builder for the real widget and the /workflows demo one.
  // The muted label column (aligned across the agents/terminals/workflows
  // widgets) is what tells the three strips apart at a glance.
  const widgetLines = (theme: OverlayTheme, runs: WidgetRun[]) =>
    runs.map((run) => {
      const parts = [theme.fg("accent", "▸ ") + theme.fg("text", run.name)];
      if (run.status === "running") {
        if (run.phase) parts.push(theme.fg("muted", run.phase));
        if (run.running > 0) {
          parts.push(theme.fg("warning", `◆ ${run.running} running`));
        }
        if (run.done > 0) parts.push(theme.fg("success", `✓ ${run.done} done`));
        if (run.failed > 0) {
          parts.push(theme.fg("error", `✗ ${run.failed} failed`));
        }
      } else {
        const icon = run.status === "completed" ? "✓" : run.status === "failed" ? "✗" : "·";
        parts.push(
          theme.fg(statusColorKey(run.status), `${icon} ${statusWord(run.status)}`),
        );
      }
      parts.push(theme.fg("accent", "/workflows") + theme.fg("dim", " to manage"));
      return ` ${theme.fg("muted", "workflows".padEnd(10))} ${parts.join(theme.fg("dim", " · "))}`;
    });

  const widgetRuns = (): WidgetRun[] => {
    const now = Date.now();
    const rows: WidgetRun[] = [];
    for (const run of activeRuns.values()) {
      const record = run.record;
      if (run.rehydrated && record.status !== "running") continue;
      if (
        record.status !== "running" &&
        (record.settledAt === null || now - record.settledAt > WIDGET_LINGER_MS)
      ) {
        continue;
      }
      const row: WidgetRun = {
        name: record.name,
        phase: run.currentPhase,
        status: record.status,
        running: 0,
        done: 0,
        failed: 0,
      };
      for (const agent of run.agents.values()) {
        if (agent.state === "running") row.running += 1;
        else if (agent.state === "ok") row.done += 1;
        else row.failed += 1;
      }
      rows.push(row);
    }
    return rows;
  };

  // The widget is set ONCE per visible spell (render() pulls fresh rows);
  // re-setting on every change would reorder it against other widgets. The
  // ticker re-renders so lingering runs expire without user activity.
  const updateWidget = () => {
    if (!currentCtx) return;
    const visible = widgetRuns().length > 0;
    if (!visible) {
      if (widgetVisible) currentCtx.ui.setWidget("workflows", undefined);
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
      "workflows",
      (tui, theme) => {
        nudgeWidget = () => tui.requestRender();
        return {
          invalidate() {},
          render: () => widgetLines(theme, widgetRuns()),
        };
      },
      { placement: "belowEditor" },
    );
  };

  pi.on("session_start", (_event, ctx) => {
    shuttingDown = false;
    currentCtx = ctx;
    const liveIds = new Set(
      [...activeRuns.values()]
        .filter((run) => run.record.status === "running" && !run.rehydrated)
        .map((run) => run.record.runId),
    );
    const referencedRunIds = referencedWorkflowRunIds(
      ctx.sessionManager.getBranch(),
    );
    for (const loaded of loadSessionRunsFromDisk(
      liveIds,
      ctx.sessionManager.getSessionId(),
      referencedRunIds,
    )) {
      if (activeRuns.has(loaded.record.runId)) continue;
      activeRuns.set(loaded.record.runId, {
        record: loaded.record,
        dir: loaded.dir,
        phases: loaded.phases,
        agents: new Map(loaded.agents.map((agent) => [agent.seq, agent])),
        logs: [],
        abort: new AbortController(),
        rehydrated: true,
      });
    }
    updateWidget();
  });

  pi.on("agent_settled", () => {
    if (!shuttingDown) {
      for (const [runId, text] of pendingResults) sendResult(runId, text);
    }
    pendingResults.clear();
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    currentCtx = undefined;
    pendingResults.clear();
    if (widgetTimer) {
      clearInterval(widgetTimer);
      widgetTimer = undefined;
    }
    widgetVisible = false;
    nudgeWidget = undefined;
    for (const run of activeRuns.values()) run.abort.abort();
    await Promise.allSettled([...liveTasks]);
    // Background completion callbacks run as part of tracked tasks, but keep
    // this clear as a final guard against stale follow-ups crossing runtimes.
    pendingResults.clear();
  });

  // Follow-up results collapse to their summary line; ctrl+o expands.
  pi.registerMessageRenderer(RESULT_MESSAGE_TYPE, (message, options, theme) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : (message.content?.find((c) => c.type === "text") as { text: string } | undefined)
            ?.text ?? "";
    if (options.expanded) {
      return new Text(theme.fg("accent", "▸ ") + theme.fg("text", text), 0, 0);
    }
    const [first = "", ...rest] = text.split("\n");
    const more = rest.some((line) => line.trim() !== "");
    return new Text(
      theme.fg("accent", "▸ ") +
        theme.fg("text", first) +
        (more ? theme.fg("dim", " …") : ""),
      0,
      0,
    );
  });

  async function executeRunInternal(options: {
    source: string;
    args: unknown;
    ctx: ExtensionContext;
    signal: AbortSignal | undefined;
    runId?: string;
    resumedFrom?: string;
    replayEntries?: readonly ReplayEntry[];
    onProgress?: (text: string) => void;
  }): Promise<{ record: RunRecord; result: SandboxResult; dir: string }> {
    const { meta, body } = extractMeta(options.source);
    const runId = options.runId ?? newRunId();
    const store = createRunStore(runId);
    const abort = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) abort.abort();
      else options.signal.addEventListener("abort", () => abort.abort(), { once: true });
    }

    const record: RunRecord = {
      runId,
      name: meta.name,
      description: meta.description,
      status: "running",
      startedAt: Date.now(),
      settledAt: null,
      agentCount: 0,
      ownerPid: process.pid,
      cwd: normalizeWorkflowCwd(options.ctx.cwd),
      sessionId: options.ctx.sessionManager.getSessionId(),
      ...(options.resumedFrom ? { resumedFrom: options.resumedFrom } : {}),
    };
    const run: ActiveRun = {
      record,
      dir: store.dir,
      phases: meta.phases,
      agents: new Map(),
      logs: [],
      abort,
    };
    activeRuns.set(runId, run);
    updateWidget();

    const progress = () => {
      const agents = [...run.agents.values()];
      const parts = [
        `workflow ${meta.name} · ${run.currentPhase ?? "…"}`,
        `${agents.filter((a) => a.state === "running").length} running / ${agents.filter((a) => a.state !== "running").length} done`,
      ];
      if (run.logs.length > 0) parts.push(run.logs.at(-1)!);
      options.onProgress?.(parts.join("\n"));
    };

    const requestMeta = new Map<number, { promptHash: string; optsHash: string }>();
    const replayer = options.replayEntries
      ? createPrefixReplayer(options.replayEntries)
      : undefined;
    const handleRunnerEvent = (event: RunnerEvent) => {
      if (event.state === "started") {
        record.agentCount += 1;
        run.agents.set(event.seq, {
          seq: event.seq,
          label: event.label,
          phase: event.phase,
          state: "running",
          prompt: event.prompt,
          agentType: event.agentType,
          activity: [],
          startedAt: Date.now(),
        });
      } else if (event.state === "activity") {
        const agent = run.agents.get(event.seq);
        if (agent) {
          if (event.preview) {
            agent.activity.push(event.preview);
            if (agent.activity.length > MAX_AGENT_ACTIVITY) agent.activity.shift();
          }
          agent.model = event.model ?? agent.model;
          agent.tokens = event.tokens ?? agent.tokens;
          agent.contextWindow = event.contextWindow ?? agent.contextWindow;
          agent.toolCalls = event.toolCalls ?? agent.toolCalls;
        }
      } else {
        const agent = run.agents.get(event.seq);
        if (agent) {
          agent.state = event.ok ? "ok" : "failed";
          agent.error = event.error;
          agent.durationMs = event.durationMs;
          agent.output = event.output?.slice(0, 2_000);
          agent.model = event.model ?? agent.model;
          agent.tokens = event.tokens ?? agent.tokens;
          agent.contextWindow = event.contextWindow ?? agent.contextWindow;
          agent.toolCalls = event.toolCalls ?? agent.toolCalls;
        }
        const hashes = requestMeta.get(event.seq);
        // Both fresh and replayed calls take this one persistence path, so
        // the new run has exactly one journal row + full artifact per call.
        const resultRef = store.saveAgentResult({
          seq: event.seq,
          ok: event.ok ?? false,
          prompt: agent?.prompt,
          output: event.output,
          structured: event.structured,
          error: event.error,
        });
        store.appendJournal({
          seq: event.seq,
          promptHash: hashes?.promptHash ?? "",
          optsHash: hashes?.optsHash ?? "",
          label: event.label,
          phase: event.phase,
          ok: event.ok ?? false,
          error: event.error,
          outputHead: event.output?.slice(0, 200),
          resultRef,
        });
      }
      updateWidget();
      progress();
    };

    // createAgentRunner does not throw; safe to hold as a const for finally.
    const runner = createAgentRunner({
      context: {
        cwd: options.ctx.cwd,
        projectTrusted: options.ctx.isProjectTrusted(),
        modelRegistry: options.ctx.modelRegistry,
        parentModel: options.ctx.model,
      },
      signal: abort.signal,
      onEvent: handleRunnerEvent,
    });

    // Everything fallible runs here; the finally guarantees the run is
    // finalized in memory + on disk and the runner disposed, so a throw
    // (disk error, etc.) can't leave a stale "running" run or leak child
    // sessions.
    try {
      store.saveInputs(options.source, options.args, meta);
      store.saveStatus(record);
      const result = await runWorkflowSandbox({
        body,
        args: options.args,
        maxAgentCalls: MAX_AGENT_CALLS,
        signal: abort.signal,
        handlers: {
          onPhase: (title) => {
            run.currentPhase = title;
            updateWidget();
            progress();
          },
          onLog: (message) => {
            run.logs.push(message);
            progress();
          },
          runAgent: async (request) => {
            const hashes = {
              promptHash: hashForJournal(request.prompt),
              optsHash: hashForJournal(request.opts),
            };
            requestMeta.set(request.id, hashes);
            const replay = replayer?.tryReplay({ seq: request.id, ...hashes });
            if (replay?.hit) {
              const label = request.opts.label ?? `agent-${request.id}`;
              handleRunnerEvent({
                seq: request.id,
                label,
                phase: request.opts.phase,
                state: "started",
                prompt: request.prompt,
                agentType: request.opts.agentType ?? "worker",
              });
              handleRunnerEvent({
                seq: request.id,
                label,
                phase: request.opts.phase,
                state: "activity",
                preview: `↻ replayed from ${options.resumedFrom ?? "source run"}`,
              });
              handleRunnerEvent({
                seq: request.id,
                label,
                phase: request.opts.phase,
                state: "settled",
                ok: replay.outcome.ok,
                output: replay.outcome.output,
                structured: replay.outcome.structured,
                error: replay.outcome.error,
                durationMs: 0,
              });
              return replay.outcome;
            }
            return runner.run(request);
          },
        },
      });
      record.status = abort.signal.aborted
        ? "aborted"
        : result.ok
          ? "completed"
          : "failed";
      if (!result.ok) record.error = result.error;
      if (result.ok) store.saveResult(result.value);
      return { record, result, dir: store.dir };
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      record.settledAt ??= Date.now();
      await runner.disposeAll();
      try {
        store.saveStatus(record);
      } catch {
        // Disk unavailable during teardown — in-memory record is still finalized.
      }
      updateWidget();
    }
  }

  function executeRun(
    options: Parameters<typeof executeRunInternal>[0],
  ) {
    return trackTask(executeRunInternal(options));
  }

  function startBackgroundRun(options: {
    source: string;
    args: unknown;
    ctx: ExtensionContext;
    resumedFrom?: string;
    replayEntries?: readonly ReplayEntry[];
  }) {
    // Validate meta and allocate the runId before detaching so callers can
    // report the new ID immediately.
    const { meta } = extractMeta(options.source);
    const runId = newRunId();
    const backgroundTask = executeRun({
      ...options,
      signal: undefined,
      runId,
    })
      .then(({ record, result, dir }) => {
        deliverOrQueue(
          record.runId,
          buildRunResult(record, result.ok ? result.value : undefined, dir),
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        deliverOrQueue(
          runId,
          buildBackgroundFailureMessage(meta.name, runId, message),
        );
      });
    trackTask(backgroundTask);
    return { runId, name: meta.name };
  }

  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description: WORKFLOW_DESCRIPTION,
    parameters: Type.Object({
      script: Type.Optional(
        Type.String({ description: PARAMETER_DESCRIPTIONS.script }),
      ),
      name: Type.Optional(Type.String({ description: PARAMETER_DESCRIPTIONS.name })),
      resume_run_id: Type.Optional(
        Type.String({ description: PARAMETER_DESCRIPTIONS.resumeRunId }),
      ),
      args: Type.Optional(Type.Unknown({ description: PARAMETER_DESCRIPTIONS.args })),
      background: Type.Optional(
        Type.Boolean({ description: PARAMETER_DESCRIPTIONS.background }),
      ),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const selectors = [params.script, params.name, params.resume_run_id].filter(
        (value) => value !== undefined,
      );
      if (selectors.length !== 1) {
        throw new Error("Pass exactly one of script, name, or resume_run_id.");
      }

      let source = params.script;
      let args = params.args;
      let resumedFrom: string | undefined;
      let replayEntries: readonly ReplayEntry[] | undefined;
      if (params.name) {
        const named = resolveNamedWorkflow(params.name, ctx.cwd);
        if (!named) {
          throw new Error(
            `No saved workflow "${params.name}" in .pi/workflows or .claude/workflows.`,
          );
        }
        source = named.source;
      } else if (params.resume_run_id) {
        if (Object.prototype.hasOwnProperty.call(params, "args")) {
          throw new Error(
            "Do not pass args with resume_run_id; resume uses the source run's stored args.",
          );
        }
        if (activeRuns.get(params.resume_run_id)?.record.status === "running") {
          throw new Error(
            `Workflow "${params.resume_run_id}" is still running; wait for it to settle before resuming.`,
          );
        }
        const stored = loadResumeSource(params.resume_run_id, ctx.cwd);
        source = stored.source;
        args = stored.args;
        resumedFrom = stored.record.runId;
        replayEntries = stored.replayEntries;
      }
      if (source === undefined) {
        throw new Error("Workflow source could not be resolved.");
      }

      if (params.background) {
        const started = startBackgroundRun({
          source,
          args,
          ctx,
          resumedFrom,
          replayEntries,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: buildBackgroundStartMessage(started.name, started.runId),
            },
          ],
          details: { runId: started.runId, status: "running", resumedFrom },
        };
      }

      const { record, result, dir } = await executeRun({
        source,
        args,
        ctx,
        signal,
        resumedFrom,
        replayEntries,
        onProgress: (text) =>
          onUpdate?.({ content: [{ type: "text" as const, text }], details: {} }),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: buildRunResult(record, result.ok ? result.value : undefined, dir),
          },
        ],
        details: {
          runId: record.runId,
          status: record.status,
          resumedFrom: record.resumedFrom,
        },
      };
    },
    // The result JSON matters to the model; the human gets the summary
    // line (ctrl+o expands, /workflows has the full dashboard).
    renderResult(result, options, theme) {
      const text = resultText(result);
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        summary: previewOf(text, 1)[0] ?? "workflow finished",
        fullText: text,
      });
    },
  });

  let demoWidgetTimer: ReturnType<typeof setTimeout> | undefined;

  pi.registerTool({
    name: "workflow_status",
    label: "Workflow Status",
    description: WORKFLOW_STATUS_DESCRIPTION,
    parameters: Type.Object({
      run_id: Type.String({ description: STATUS_PARAMETER_DESCRIPTIONS.runId }),
    }),
    async execute(_id, params) {
      const run = activeRuns.get(params.run_id);
      if (!run) {
        const known = [...activeRuns.keys()];
        throw new Error(
          known.length > 0
            ? `No workflow run "${params.run_id}". Known runs: ${known.join(", ")}.`
            : `No workflow runs found in memory or on disk.`,
        );
      }
      return {
        content: [
          {
            type: "text" as const,
            text: buildWorkflowStatus(run.record, {
              currentPhase: run.currentPhase,
              agents: [...run.agents.values()],
              logs: run.logs,
              dir: run.dir,
            }),
          },
        ],
        details: { runId: run.record.runId, status: run.record.status },
      };
    },
    renderResult(result, options, theme) {
      const text = resultText(result);
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        summary: previewOf(text, 1)[0] ?? "no status",
        fullText: text,
      });
    },
  });

  pi.registerCommand("workflows", {
    description: "Inspect workflow runs (`/workflows demo` previews the UI)",
    handler: async (args, ctx) => {
      if (args?.trim() === "demo") {
        // Fixture-backed preview: same dashboard + widget code paths,
        // no real agents. The widget lingers so it can be seen under
        // the input after the overlay closes.
        if (demoWidgetTimer) clearTimeout(demoWidgetTimer);
        ctx.ui.setWidget(
          "workflows-demo",
          (_tui, theme) => ({
            invalidate() {},
            render: () =>
              widgetLines(theme, [
                {
                  name: "review-diff",
                  phase: "Verify",
                  status: "running",
                  running: 1,
                  done: 3,
                  failed: 1,
                },
              ]),
          }),
          { placement: "belowEditor" },
        );
        try {
          await showWorkflowsDashboard(
            ctx,
            demoWorkflowsHost(createDemoRuns(Date.now())),
          );
        } finally {
          ctx.ui.notify("demo widget below the input clears in 20s", "info");
          demoWidgetTimer = setTimeout(
            () => currentCtx?.ui.setWidget("workflows-demo", undefined),
            20_000,
          );
        }
        return;
      }
      // session_start rehydrates inspectable disk runs into the same map, so
      // the dashboard has one live-updating host for current and past runs.
      const toView = (run: ActiveRun): RunView => ({
        record: run.record,
        phases: run.phases,
        currentPhase: run.currentPhase,
        agents: [...run.agents.values()],
        logs: run.logs,
        dir: run.dir,
      });
      await showWorkflowsDashboard(ctx, {
        getRuns: () =>
          sortRunningFirst(
            [...activeRuns.values()],
            (run) => run.record.status === "running",
            (run) =>
              run.record.status === "running"
                ? run.record.startedAt
                : (run.record.settledAt ?? run.record.startedAt),
          ).map(toView),
        stop: (runId) => activeRuns.get(runId)?.abort.abort(),
        resume: (runId) => {
          const stored = loadResumeSource(runId, ctx.cwd);
          return startBackgroundRun({
            source: stored.source,
            args: stored.args,
            ctx,
            resumedFrom: stored.record.runId,
            replayEntries: stored.replayEntries,
          }).runId;
        },
      });
    },
  });
}
