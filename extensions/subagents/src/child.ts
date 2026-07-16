/**
 * Real child sessions over the pi SDK: in-process AgentSession with real
 * session files, trust-gated resources, the child tool denylist, a
 * per-tool timeout guard, and a first-response watchdog.
 */

import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionEvent,
  ModelRegistry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const SHUTDOWN_TIMEOUT_MS = 5_000;
const TOOL_CALL_TIMEOUT_MS = 3 * 60 * 1_000;
const FIRST_RESPONSE_WATCHDOG_MS = 45_000;

/** Fresh array per call — a shared one would become an accidental allowlist. */
export function childExcludedTools() {
  return [
    "subagent_spawn",
    "subagent_send",
    "subagent_wait",
    "subagent_check",
    "subagent_cancel",
    "subagent_list",
    "workflow",
    "ask_user",
    "bg_start",
    "bg_status",
    "bg_list",
    "bg_kill",
  ];
}

/**
 * Same-cwd children inherit the live parent decision; an alternate cwd is
 * trusted only when pi's persisted trust store says so. Fails closed.
 */
export function resolveChildTrust(options: {
  parentCwd: string;
  childCwd: string;
  parentTrusted: boolean;
}) {
  if (path.resolve(options.childCwd) === path.resolve(options.parentCwd)) {
    return options.parentTrusted;
  }
  try {
    return new ProjectTrustStore(getAgentDir()).get(options.childCwd) === true;
  } catch {
    return false;
  }
}

/**
 * "provider/id" is exact; a bare id prefers the parent's provider, then
 * must be unambiguous. No hint inherits the parent model.
 */
export function resolveModel(
  registry: ModelRegistry,
  hint: string | undefined,
  parent: Model<any> | undefined,
): Model<any> | undefined {
  if (!hint) return parent;
  const slash = hint.indexOf("/");
  if (slash > 0) {
    const found = registry.find(hint.slice(0, slash), hint.slice(slash + 1));
    if (found) return found;
    throw new Error(`Unknown model "${hint}".`);
  }
  if (parent) {
    const found = registry.find(parent.provider, hint);
    if (found) return found;
  }
  const matches = registry.getAll().filter((m) => m.id === hint);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Model "${hint}" exists in multiple providers (${matches.map((m) => m.provider).join(", ")}). Use "provider/${hint}".`,
    );
  }
  throw new Error(`Unknown model "${hint}".`);
}

function waitBounded(operation: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Wrap every child tool with an independent timeout; idempotent. */
function createToolTimeoutGuard(timeoutMs = TOOL_CALL_TIMEOUT_MS) {
  const wrapped = new WeakSet<ToolDefinition>();
  const wrap = (definition: ToolDefinition) => {
    if (wrapped.has(definition)) return;
    wrapped.add(definition);
    const execute = definition.execute;
    definition.execute = async (toolCallId, params, signal, onUpdate, ctx) => {
      const controller = new AbortController();
      const executionSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            `Tool call "${definition.name}" timed out after ${Math.round(timeoutMs / 60_000)} minutes.`,
          );
          reject(error);
          controller.abort(error);
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          execute.call(definition, toolCallId, params, executionSignal, onUpdate, ctx),
          timeout,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
  };
  return {
    apply(session: AgentSession) {
      for (const { name } of session.getAllTools()) {
        const definition = session.getToolDefinition(name);
        if (definition) wrap(definition);
      }
    },
  };
}

export type RunOutcome =
  | { kind: "completed"; finalText: string }
  | { kind: "failed"; errorText: string; partialText?: string }
  | { kind: "interrupted"; partialText?: string };

export type ChildEvent =
  | { type: "run-started" }
  | { type: "activity"; preview: string }
  | { type: "run-settled"; outcome: RunOutcome };

export interface ChildHandle {
  sessionFile: string | undefined;
  modelLabel: string | undefined;
  thinkingLevel: string | undefined;
  prompt(text: string): void;
  steer(text: string): Promise<void>;
  isStreaming(): boolean;
  interrupt(): Promise<void>;
  dispose(): Promise<void>;
  usage(): { tokens?: number; contextWindow?: number };
  finalText(): string;
  /** Last N transcript lines, derived from session messages on demand. */
  transcriptTail(lines: number): string[];
}

export interface CreateChildOptions {
  cwd: string;
  projectTrusted: boolean;
  modelRegistry: ModelRegistry;
  model: Model<any> | undefined;
  thinkingLevel: string | undefined;
  allowTools?: string[];
  appendSystemPrompt?: string;
  /** Extra tools for this child (e.g. a structured-output reporter). */
  customTools?: ToolDefinition[];
  /** In-memory session — no file in /resume (workflow agents). */
  inMemorySession?: boolean;
  sessionName: string;
  onEvent: (event: ChildEvent) => void;
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4096);
}

function messageText(message: unknown, role: string): string {
  const record = message as { role?: string; content?: unknown };
  if (record.role !== role) return "";
  if (typeof record.content === "string") return record.content;
  if (!Array.isArray(record.content)) return "";
  return record.content
    .filter(
      (part): part is { type: string; text: string } =>
        !!part && typeof part === "object" && (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

export async function createChild(options: CreateChildOptions): Promise<ChildHandle> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(options.cwd, agentDir, {
    projectTrusted: options.projectTrusted,
  });
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    ...(options.appendSystemPrompt
      ? { appendSystemPrompt: [options.appendSystemPrompt] }
      : {}),
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: options.cwd,
    sessionManager: options.inMemorySession
      ? SessionManager.inMemory(options.cwd)
      : SessionManager.create(options.cwd),
    settingsManager,
    resourceLoader: loader,
    model: options.model as never,
    thinkingLevel: options.thinkingLevel as never,
    excludeTools: childExcludedTools(),
    ...(options.customTools ? { customTools: options.customTools } : {}),
  });

  try {
    await session.bindExtensions({ mode: "print" });
  } catch (error) {
    await shutdown(session);
    throw error;
  }

  if (options.allowTools) {
    const available = new Set(session.getAllTools().map((t) => t.name));
    session.setActiveToolsByName(
      options.allowTools.filter((name) => available.has(name)),
    );
  }

  const guard = createToolTimeoutGuard();
  guard.apply(session);

  const state = {
    closed: false,
    settled: true,
    runError: undefined as string | undefined,
    watchdog: undefined as ReturnType<typeof setTimeout> | undefined,
  };

  const emit = (event: ChildEvent) => {
    if (!state.closed) options.onEvent(event);
  };

  const clearWatchdog = () => {
    if (state.watchdog) clearTimeout(state.watchdog);
    state.watchdog = undefined;
  };

  const finalText = () => {
    const messages = session.messages as unknown[];
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = messageText(messages[i], "assistant").trim();
      if (text) return text;
    }
    return "";
  };

  const settle = () => {
    if (state.settled) return;
    state.settled = true;
    clearWatchdog();
    const messages = session.messages as { stopReason?: string; errorMessage?: string; role?: string }[];
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    const partialText = finalText() || undefined;
    if (last?.stopReason === "aborted") {
      emit({ type: "run-settled", outcome: { kind: "interrupted", partialText } });
      return;
    }
    const errorText =
      state.runError ??
      (last?.stopReason === "error" ? (last.errorMessage ?? "Run failed") : undefined);
    if (errorText !== undefined) {
      emit({
        type: "run-settled",
        outcome: { kind: "failed", errorText: boundedError(errorText), partialText },
      });
      return;
    }
    emit({ type: "run-settled", outcome: { kind: "completed", finalText: finalText() } });
  };

  const handleEvent = (event: AgentSessionEvent) => {
    if (state.closed) return;
    switch (event.type) {
      case "agent_start":
        // Do NOT clear the watchdog here — agent_start fires before any
        // provider response, so clearing it would defeat the first-
        // response guard. It clears only on real output below.
        guard.apply(session); // tools may register between runs
        break;
      case "message_update":
        clearWatchdog();
        break;
      case "tool_execution_start":
        clearWatchdog(); // a tool call is a real first response
        emit({ type: "activity", preview: `→ ${event.toolName}` });
        break;
      case "tool_execution_end":
        emit({
          type: "activity",
          preview: `${event.isError ? "✗" : "✓"} ${event.toolName}`,
        });
        break;
      case "agent_settled":
        settle();
        break;
    }
  };
  const unsubscribe = session.subscribe(handleEvent);

  const startRun = (text: string) => {
    state.runError = undefined;
    state.settled = false;
    emit({ type: "run-started" });
    clearWatchdog();
    state.watchdog = setTimeout(() => {
      if (!state.settled && !session.isStreaming) {
        state.runError = `No response from the provider within ${FIRST_RESPONSE_WATCHDOG_MS / 1000}s.`;
        void session.abort().catch(() => undefined);
        settle();
      }
    }, FIRST_RESPONSE_WATCHDOG_MS);
    state.watchdog.unref?.();
    void session.prompt(text).catch((error) => {
      state.runError = boundedError(error);
      // Preflight failures may never start the agent lifecycle.
      if (!session.isStreaming) settle();
    });
  };

  async function shutdown(target: AgentSession) {
    try {
      if (target.extensionRunner.hasHandlers("session_shutdown")) {
        await waitBounded(
          target.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
          SHUTDOWN_TIMEOUT_MS,
        );
      }
    } catch {
      // Best-effort during teardown.
    } finally {
      try {
        target.dispose();
      } catch {
        // Idempotent disposal.
      }
    }
  }

  try {
    session.sessionManager.appendSessionInfo(`subagent: ${options.sessionName}`);
  } catch {
    // Naming is best-effort.
  }

  return {
    sessionFile: session.sessionFile,
    modelLabel: session.model
      ? `${session.model.provider}/${session.model.id}`
      : undefined,
    thinkingLevel: String(session.thinkingLevel ?? "") || undefined,
    prompt: startRun,
    steer: (text) => session.steer(text),
    isStreaming: () => session.isStreaming,
    async interrupt() {
      if (state.closed) return;
      try {
        session.clearQueue();
      } catch {
        // Abort regardless.
      }
      await session.abort().catch(() => undefined);
      const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
      while (!state.closed && session.isStreaming && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!state.settled) {
        state.settled = true;
        clearWatchdog();
        emit({ type: "run-settled", outcome: { kind: "interrupted" } });
      }
    },
    async dispose() {
      if (state.closed) return;
      state.closed = true;
      clearWatchdog();
      unsubscribe();
      try {
        session.clearQueue();
      } catch {
        // Continue with abort/dispose.
      }
      await waitBounded(session.abort(), SHUTDOWN_TIMEOUT_MS);
      await shutdown(session);
    },
    usage() {
      const usage = session.getContextUsage();
      return {
        tokens: usage?.tokens ?? undefined,
        contextWindow: session.model?.contextWindow ?? usage?.contextWindow,
      };
    },
    finalText,
    transcriptTail(lines: number) {
      const out: string[] = [];
      for (const message of session.messages as unknown[]) {
        const record = message as { role?: string; content?: unknown };
        if (record.role === "user") {
          const text = messageText(message, "user").trim();
          if (text) out.push(`> ${text.split("\n")[0]}`);
        } else if (record.role === "assistant") {
          // Early responses are often pure tool calls with no text —
          // show them, or a mid-run transcript looks empty.
          if (!Array.isArray(record.content)) continue;
          for (const part of record.content as {
            type?: string;
            text?: string;
            name?: string;
          }[]) {
            if (part?.type === "text" && part.text?.trim()) {
              out.push(...part.text.trim().split("\n"));
            } else if (part?.type === "toolCall" && part.name) {
              out.push(`  → ${part.name}`);
            }
          }
        }
      }
      return out.slice(-lines);
    },
  };
}
