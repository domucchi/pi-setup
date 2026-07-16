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

    try {
      if (options.signal?.aborted) {
        return { ok: false, output: "", error: "Run aborted." };
      }
      const definitions = loadAgentDefinitions({
        agentDir: getAgentDir(),
        cwd: options.context.cwd,
        projectTrusted: options.context.projectTrusted,
      });
      const definition = definitions.get(request.opts.agentType ?? "worker");
      if (!definition) {
        return {
          ok: false,
          output: "",
          error: `Unknown agentType "${request.opts.agentType}".`,
        };
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
      const durationMs = Date.now() - startedAt;

      if (outcome.kind === "completed") {
        let structured: unknown;
        if (request.opts.schema) {
          structured = capture.value;
          if (structured === undefined) {
            options.onEvent?.({
              seq: request.id,
              label,
              phase: request.opts.phase,
              state: "settled",
              ok: false,
              error: "schema requested but report_result was never called",
              durationMs,
            });
            return {
              ok: false,
              output: outcome.finalText,
              error: `The agent never called ${REPORT_TOOL_NAME}; no structured result.`,
            };
          }
        }
        options.onEvent?.({
          seq: request.id,
          label,
          phase: request.opts.phase,
          state: "settled",
          ok: true,
          durationMs,
          output: outcome.finalText,
          structured,
        });
        return { ok: true, output: outcome.finalText, structured };
      }

      const error =
        outcome.kind === "failed" ? outcome.errorText : "Agent run was interrupted.";
      options.onEvent?.({
        seq: request.id,
        label,
        phase: request.opts.phase,
        state: "settled",
        ok: false,
        error,
        durationMs,
      });
      return { ok: false, output: outcome.partialText ?? "", error };
    } catch (error) {
      return {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      semaphore.release();
    }
  }

  async function disposeAll() {
    await Promise.all(disposers.splice(0).map((dispose) => dispose().catch(() => {})));
  }

  return { run, disposeAll };
}
