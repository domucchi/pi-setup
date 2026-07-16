/**
 * Serves the sandbox's agent() requests: each becomes one in-memory pi
 * child (subagents' createChild — trust rules, denylist, timeout guard,
 * watchdog). Never throws — every failure settles into an outcome.
 */

import type { Model } from "@earendil-works/pi-ai";
import type {
  ModelRegistry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadAgentDefinitions } from "../../subagents/src/agents.ts";
import {
  createChild,
  resolveModel,
  type RunOutcome,
} from "../../subagents/src/child.ts";
import type { SandboxAgentOutcome, SandboxAgentRequest } from "./sandbox.ts";

export const AGENT_CONCURRENCY = 4;

export interface RunnerEvent {
  seq: number;
  label: string;
  phase?: string;
  state: "started" | "settled";
  ok?: boolean;
  error?: string;
  durationMs?: number;
  /** Settled only — the agent's return value, for the resume journal. */
  output?: string;
  structured?: unknown;
}

export interface RunnerContext {
  cwd: string;
  projectTrusted: boolean;
  modelRegistry: ModelRegistry;
  parentModel: Model<any> | undefined;
}

/** Minimal counting semaphore. */
function makeSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return {
    async acquire() {
      if (active < limit) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
      active += 1;
    },
    release() {
      active -= 1;
      queue.shift()?.();
    },
  };
}

const REPORT_TOOL_NAME = "report_result";

function buildReportTool(
  schema: unknown,
  capture: { value?: unknown },
): ToolDefinition {
  return {
    name: REPORT_TOOL_NAME,
    label: "Report Result",
    description:
      "Report your final structured result. Call exactly once, as your last action; its arguments ARE your return value.",
    parameters: Type.Unsafe(schema as Record<string, unknown>),
    async execute(_toolCallId, params) {
      capture.value = params;
      return {
        content: [{ type: "text" as const, text: "Result recorded." }],
        details: {},
      };
    },
  } as ToolDefinition;
}

export function createAgentRunner(options: {
  context: RunnerContext;
  onEvent?: (event: RunnerEvent) => void;
  signal?: AbortSignal;
}) {
  const semaphore = makeSemaphore(AGENT_CONCURRENCY);
  const disposers: (() => Promise<void>)[] = [];

  async function run(request: SandboxAgentRequest): Promise<SandboxAgentOutcome> {
    await semaphore.acquire();
    const startedAt = Date.now();
    const label = request.opts.label ?? `agent-${request.id}`;
    options.onEvent?.({
      seq: request.id,
      label,
      phase: request.opts.phase,
      state: "started",
    });

    // Exactly one settled event per started request, whatever path we take
    // (abort, unknown role, error, or a real run) — so every agent lands in
    // the /workflows tree and the resume journal.
    let finalized = false;
    const finalize = (outcome: SandboxAgentOutcome): SandboxAgentOutcome => {
      if (finalized) return outcome;
      finalized = true;
      options.onEvent?.({
        seq: request.id,
        label,
        phase: request.opts.phase,
        state: "settled",
        ok: outcome.ok,
        error: outcome.error,
        durationMs: Date.now() - startedAt,
        output: outcome.output,
        structured: outcome.structured,
      });
      return outcome;
    };

    try {
      if (options.signal?.aborted) {
        return finalize({ ok: false, output: "", error: "Run aborted." });
      }
      const definitions = loadAgentDefinitions({
        agentDir: getAgentDir(),
        cwd: options.context.cwd,
        projectTrusted: options.context.projectTrusted,
      });
      const definition = definitions.get(request.opts.agentType ?? "worker");
      if (!definition) {
        return finalize({
          ok: false,
          output: "",
          error: `Unknown agentType "${request.opts.agentType}".`,
        });
      }

      const capture: { value?: unknown } = {};
      const customTools = request.opts.schema
        ? [buildReportTool(request.opts.schema, capture)]
        : undefined;
      const schemaInstruction = request.opts.schema
        ? `\n\nWhen you are done, call the ${REPORT_TOOL_NAME} tool exactly once with your final result — its arguments are your return value. Do not answer in prose instead.`
        : "";

      const settled = new Promise<RunOutcome>((resolve) => {
        void createChild({
          cwd: options.context.cwd,
          projectTrusted: options.context.projectTrusted,
          modelRegistry: options.context.modelRegistry,
          model: resolveModel(
            options.context.modelRegistry,
            request.opts.model ?? definition.model,
            options.context.parentModel,
          ),
          thinkingLevel:
            request.opts.effort ?? request.opts.thinking ?? definition.thinking ?? undefined,
          allowTools: definition.tools
            ? [...definition.tools, ...(request.opts.schema ? [REPORT_TOOL_NAME] : [])]
            : undefined,
          appendSystemPrompt: (definition.systemPrompt ?? "") + schemaInstruction,
          customTools,
          inMemorySession: true,
          sessionName: `workflow: ${label}`,
          onEvent: (event) => {
            if (event.type === "run-settled") resolve(event.outcome);
          },
        }).then(
          (child) => {
            disposers.push(() => child.dispose());
            child.prompt(request.prompt);
          },
          (error) =>
            resolve({
              kind: "failed",
              errorText: error instanceof Error ? error.message : String(error),
            }),
        );
      });

      const outcome = await settled;

      if (outcome.kind === "completed") {
        if (request.opts.schema && capture.value === undefined) {
          return finalize({
            ok: false,
            output: outcome.finalText,
            error: `The agent never called ${REPORT_TOOL_NAME}; no structured result.`,
          });
        }
        return finalize({
          ok: true,
          output: outcome.finalText,
          structured: request.opts.schema ? capture.value : undefined,
        });
      }

      const error =
        outcome.kind === "failed" ? outcome.errorText : "Agent run was interrupted.";
      return finalize({ ok: false, output: outcome.partialText ?? "", error });
    } catch (error) {
      return finalize({
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Safety net: if some path returned without finalizing, still emit.
      finalize({ ok: false, output: "", error: "Agent did not report an outcome." });
      semaphore.release();
    }
  }

  async function disposeAll() {
    await Promise.all(disposers.splice(0).map((dispose) => dispose().catch(() => {})));
  }

  return { run, disposeAll };
}
