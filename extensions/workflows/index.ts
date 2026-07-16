/**
 * workflows — model-authored orchestration scripts over sandboxed
 * execution. Design: extensions/workflows/DESIGN.md. The script runs in
 * a permission-restricted Node child (src/sandbox*), agents run through
 * subagents' createChild with in-memory sessions (src/runner), and
 * every run leaves an audit trail + resume-ready journal on disk
 * (src/artifacts).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { livePicker } from "../shared/live-picker.ts";
import {
  buildRunResult,
  describeRun,
  PARAMETER_DESCRIPTIONS,
  WORKFLOW_DESCRIPTION,
  WORKFLOW_PROMPT_GUIDELINES,
  WORKFLOW_PROMPT_SNIPPET,
} from "./prompt.ts";
import {
  createRunStore,
  hashForJournal,
  listRunsFromDisk,
  newRunId,
  type RunRecord,
} from "./src/artifacts.ts";
import { extractMeta } from "./src/meta.ts";
import { resolveNamedWorkflow } from "./src/named.ts";
import { createAgentRunner, type RunnerEvent } from "./src/runner.ts";
import { runWorkflowSandbox, type SandboxResult } from "./src/sandbox.ts";

const MAX_AGENT_CALLS = 32;
const RESULT_MESSAGE_TYPE = "workflow-result";

interface ActiveAgent {
  seq: number;
  label: string;
  phase?: string;
  state: "running" | "ok" | "failed";
  error?: string;
  durationMs?: number;
}

interface ActiveRun {
  record: RunRecord;
  dir: string;
  currentPhase?: string;
  agents: Map<number, ActiveAgent>;
  logs: string[];
  abort: AbortController;
}

export default function workflows(pi: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;
  const activeRuns = new Map<string, ActiveRun>();
  const pendingResults = new Map<string, string>();

  const updateWidget = () => {
    if (!currentCtx) return;
    const running = [...activeRuns.values()].filter(
      (run) => run.record.status === "running",
    );
    currentCtx.ui.setWidget(
      "workflows",
      running.length > 0
        ? running.map(
            (run) =>
              ` ▸ workflow ${run.record.name}${run.currentPhase ? ` · ${run.currentPhase}` : ""} · ${[...run.agents.values()].filter((a) => a.state === "running").length} agent(s) · /workflows`,
          )
        : undefined,
    );
  };

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
  });

  pi.on("agent_settled", () => {
    for (const text of pendingResults.values()) {
      pi.sendMessage(
        { customType: RESULT_MESSAGE_TYPE, content: text, display: true, details: {} },
        { deliverAs: "followUp", triggerTurn: true },
      );
    }
    pendingResults.clear();
  });

  pi.on("session_shutdown", () => {
    currentCtx = undefined;
    pendingResults.clear();
    for (const run of activeRuns.values()) {
      run.abort.abort();
      if (run.record.status === "running") {
        run.record.status = "aborted";
        run.record.settledAt = Date.now();
      }
    }
  });

  pi.registerMessageRenderer(RESULT_MESSAGE_TYPE, (message, _options, theme) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : (message.content?.find((c) => c.type === "text") as { text: string } | undefined)
            ?.text ?? "";
    return new Text(theme.fg("accent", "▸ ") + theme.fg("text", text), 0, 0);
  });

  async function executeRun(options: {
    source: string;
    args: unknown;
    ctx: ExtensionContext;
    signal: AbortSignal | undefined;
    onProgress?: (text: string) => void;
  }): Promise<{ record: RunRecord; result: SandboxResult; dir: string }> {
    const { meta, body } = extractMeta(options.source);
    const runId = newRunId();
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
    };
    const run: ActiveRun = { record, dir: store.dir, agents: new Map(), logs: [], abort };
    activeRuns.set(runId, run);
    store.saveInputs(options.source, options.args, meta);
    store.saveStatus(record);
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
    const runner = createAgentRunner({
      context: {
        cwd: options.ctx.cwd,
        projectTrusted: options.ctx.isProjectTrusted(),
        modelRegistry: options.ctx.modelRegistry,
        parentModel: options.ctx.model,
      },
      signal: abort.signal,
      onEvent: (event: RunnerEvent) => {
        if (event.state === "started") {
          record.agentCount += 1;
          run.agents.set(event.seq, {
            seq: event.seq,
            label: event.label,
            phase: event.phase,
            state: "running",
          });
        } else {
          const agent = run.agents.get(event.seq);
          if (agent) {
            agent.state = event.ok ? "ok" : "failed";
            agent.error = event.error;
            agent.durationMs = event.durationMs;
          }
          const hashes = requestMeta.get(event.seq);
          store.appendJournal({
            seq: event.seq,
            promptHash: hashes?.promptHash ?? "",
            optsHash: hashes?.optsHash ?? "",
            label: event.label,
            phase: event.phase,
            ok: event.ok ?? false,
            error: event.error,
          });
        }
        updateWidget();
        progress();
      },
    });

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
        runAgent: (request) => {
          requestMeta.set(request.id, {
            promptHash: hashForJournal(request.prompt),
            optsHash: hashForJournal(request.opts),
          });
          return runner.run(request);
        },
      },
    });

    await runner.disposeAll();
    record.settledAt = Date.now();
    record.status = abort.signal.aborted
      ? "aborted"
      : result.ok
        ? "completed"
        : "failed";
    if (!result.ok) record.error = result.error;
    store.saveStatus(record);
    if (result.ok) store.saveResult(result.value);
    updateWidget();
    return { record, result, dir: store.dir };
  }

  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description: WORKFLOW_DESCRIPTION,
    promptSnippet: WORKFLOW_PROMPT_SNIPPET,
    promptGuidelines: WORKFLOW_PROMPT_GUIDELINES,
    parameters: Type.Object({
      script: Type.Optional(
        Type.String({ description: PARAMETER_DESCRIPTIONS.script }),
      ),
      name: Type.Optional(Type.String({ description: PARAMETER_DESCRIPTIONS.name })),
      args: Type.Optional(Type.Unknown({ description: PARAMETER_DESCRIPTIONS.args })),
      background: Type.Optional(
        Type.Boolean({ description: PARAMETER_DESCRIPTIONS.background }),
      ),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!params.script === !params.name) {
        throw new Error("Pass exactly one of script or name.");
      }
      let source = params.script;
      if (params.name) {
        const named = resolveNamedWorkflow(params.name, ctx.cwd);
        if (!named) {
          throw new Error(
            `No saved workflow "${params.name}" in .pi/workflows or .claude/workflows.`,
          );
        }
        source = named.source;
      }

      if (params.background) {
        // Validate meta before promising anything.
        const { meta } = extractMeta(source!);
        void executeRun({
          source: source!,
          args: params.args,
          ctx,
          signal: undefined,
        }).then(({ record, result, dir }) => {
          const text = buildRunResult(record, result.ok ? result.value : undefined, dir);
          if (currentCtx?.isIdle()) {
            pi.sendMessage(
              { customType: RESULT_MESSAGE_TYPE, content: text, display: true, details: { runId: record.runId } },
              { deliverAs: "followUp", triggerTurn: true },
            );
          } else {
            pendingResults.set(record.runId, text);
          }
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Workflow "${meta.name}" started in the background. You will be notified with the result; /workflows shows progress.`,
            },
          ],
          details: {},
        };
      }

      const { record, result, dir } = await executeRun({
        source: source!,
        args: params.args,
        ctx,
        signal,
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
        details: { runId: record.runId, status: record.status },
      };
    },
  });

  pi.registerCommand("workflows", {
    description: "Inspect workflow runs",
    handler: async (_args, ctx) => {
      const rows = () => {
        const active = [...activeRuns.values()].map((run) => run.record);
        const activeIds = new Set(active.map((r) => r.runId));
        const disk = listRunsFromDisk(activeIds).filter((r) => !activeIds.has(r.runId));
        return [...active, ...disk].map(describeRun);
      };
      if (rows().length === 0) {
        ctx.ui.notify("No workflow runs", "info");
        return;
      }
      const picked = await livePicker(ctx, "Workflow runs:", rows);
      if (picked === undefined) return;
      const active = [...activeRuns.values()];
      const run = active[picked];
      if (run) {
        const agents = [...run.agents.values()]
          .map(
            (a) =>
              `${a.state === "running" ? "◆" : a.state === "ok" ? "✓" : "✗"} ${a.label}${a.phase ? ` [${a.phase}]` : ""}${a.durationMs ? ` ${Math.round(a.durationMs / 1000)}s` : ""}${a.error ? ` — ${a.error.slice(0, 80)}` : ""}`,
          )
          .join("\n");
        ctx.ui.notify(
          `${describeRun(run.record)}\n${agents}\nArtifacts: ${run.dir}`,
          "info",
        );
      } else {
        const activeIds = new Set(active.map((r) => r.record.runId));
        const disk = listRunsFromDisk(activeIds).filter(
          (r) => !activeIds.has(r.runId),
        );
        const record = disk[picked - active.length];
        if (record) {
          ctx.ui.notify(
            `${describeRun(record)}\nArtifacts: ~/.pi/agent/workflows/${record.runId}`,
            "info",
          );
        }
      }
    },
  });
}
