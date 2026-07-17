/**
 * codex backend — Codex as a subagent via `codex app-server --stdio`
 * (LF-delimited JSON-RPC). One server process owns one persistent
 * thread: turn/start drives runs, v2 item notifications become
 * ChildEvents, turn/completed settles. Runs with approvalPolicy: never
 * + danger-full-access by explicit user decision (headless children
 * cannot answer approval prompts anyway).
 *
 * Simplified from the reference implementation: single active turn,
 * events outside the active run are dropped, interrupt has a local
 * deadline fallback.
 */

import { spawn } from "node:child_process";
import type { ChildEvent, ChildHandle, RunOutcome } from "../child.ts";
import { createLineParser, parseJsonRecord } from "./jsonl.ts";
import { findBinary } from "./resolve.ts";
import type { ExternalChildOptions } from "./claude.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const INTERRUPT_FALLBACK_MS = 8_000;
const TRANSCRIPT_MAX_LINES = 200;
const CODEX_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

type JsonRecord = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" ? value : undefined);
const rec = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

/** First line of a possibly multi-line string, clipped. */
export function firstLine(value: unknown): string | undefined {
  const text = str(value);
  return text?.split("\n")[0]?.slice(0, 120) || undefined;
}

/** Human tool name + args preview for a v2 item (pure, testable). */
export function toolPreview(
  item: JsonRecord,
): { id: string; name: string; args?: string } | undefined {
  const id = str(item.id);
  if (!id) return undefined;
  switch (str(item.type)) {
    case "commandExecution":
      return { id, name: "shell", args: firstLine(item.command) };
    case "fileChange": {
      const paths = Array.isArray(item.changes)
        ? item.changes
            .map((change) => str(rec(change)?.path))
            .filter((p): p is string => p !== undefined)
        : [];
      return { id, name: "apply_patch", args: paths.join(", ").slice(0, 120) || undefined };
    }
    case "webSearch":
      return { id, name: "web_search", args: firstLine(item.query) };
    case "mcpToolCall":
      return { id, name: str(item.tool) ?? "mcp", args: undefined };
    case "toolCall":
      return { id, name: str(item.tool) ?? "tool", args: undefined };
    default:
      return undefined;
  }
}

/** Live context usage from a thread/tokenUsage/updated notification. */
export function parseTokenUsage(params: JsonRecord) {
  const usage = rec(params.tokenUsage);
  return {
    tokens: num(rec(usage?.last)?.totalTokens),
    contextWindow: num(usage?.modelContextWindow),
  };
}

/** Clamp a pi thinking level to codex's effort scale (or omit). */
export function codexEffort(thinking: string | undefined): string | undefined {
  if (!thinking) return undefined;
  if (CODEX_EFFORTS.has(thinking)) return thinking;
  if (thinking === "xhigh" || thinking === "max") return "high";
  if (thinking === "off") return "minimal";
  return undefined;
}

export async function createCodexChild(
  options: ExternalChildOptions,
): Promise<ChildHandle> {
  const binary = findBinary("codex");
  if (!binary) {
    throw new Error(
      "codex executable not found (looked in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin, and PATH).",
    );
  }

  const child = spawn(binary, ["app-server", "--stdio"], {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.resume(); // drain, never block

  const state = {
    closed: false,
    settled: true,
    exited: false,
    threadId: undefined as string | undefined,
    activeTurnId: undefined as string | undefined,
    interruptRequested: false,
    interruptTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    modelLabel: options.model ? `codex/${options.model}` : undefined,
    tokens: undefined as number | undefined,
    contextWindow: undefined as number | undefined,
    finalText: "",
    lastAssistantText: "",
    runError: undefined as string | undefined,
    transcript: [] as string[],
  };

  const emit = (event: ChildEvent) => {
    if (!state.closed) options.onEvent(event);
  };

  const pushTranscript = (line: string) => {
    state.transcript.push(line);
    if (state.transcript.length > TRANSCRIPT_MAX_LINES) {
      state.transcript.splice(0, state.transcript.length - TRANSCRIPT_MAX_LINES);
    }
  };

  // --- JSON-RPC plumbing ---
  let requestId = 0;
  const pending = new Map<
    number,
    { resolve: (value: JsonRecord) => void; reject: (error: Error) => void }
  >();

  const write = (message: JsonRecord): boolean => {
    if (state.closed || state.exited || !child.stdin.writable) return false;
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  };

  const request = (
    method: string,
    params: JsonRecord,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<JsonRecord> =>
    new Promise((resolve, reject) => {
      requestId += 1;
      const id = requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`codex app-server request ${method} timed out.`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      if (!write({ id, method, params })) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("codex app-server stdin is closed."));
      }
    });

  const settle = (outcome: RunOutcome) => {
    if (state.settled) return;
    state.settled = true;
    state.activeTurnId = undefined;
    state.interruptRequested = false;
    if (state.interruptTimer) clearTimeout(state.interruptTimer);
    if (outcome.kind === "completed") state.finalText = outcome.finalText;
    else if (outcome.partialText) state.finalText = outcome.partialText;
    emit({ type: "run-settled", outcome });
  };

  const handleNotification = (message: JsonRecord) => {
    const method = str(message.method);
    const params = rec(message.params) ?? {};
    if (!method) return;
    // Run-scoped events are dropped when no run is active.
    const runScoped =
      method.startsWith("turn/") || method.startsWith("item/") || method === "error";
    if (runScoped && state.settled) return;

    switch (method) {
      case "thread/settings/updated": {
        const model = str(rec(params.threadSettings)?.model);
        if (model) state.modelLabel = `codex/${model}`;
        break;
      }
      case "turn/started": {
        state.activeTurnId = str(rec(params.turn)?.id) ?? state.activeTurnId;
        break;
      }
      case "item/started": {
        const item = rec(params.item);
        const tool = item ? toolPreview(item) : undefined;
        if (tool) {
          emit({
            type: "activity",
            preview: `→ ${tool.name}${tool.args ? ` ${tool.args}` : ""}`.slice(0, 140),
          });
          pushTranscript(`  → ${tool.name}${tool.args ? ` ${tool.args}` : ""}`);
        }
        break;
      }
      case "item/completed": {
        const item = rec(params.item);
        if (!item) break;
        const type = str(item.type);
        if (type === "agentMessage") {
          const text = str(item.text) ?? "";
          if (text) {
            state.lastAssistantText = text;
            if (str(item.phase) === "final_answer") state.finalText = text;
            for (const line of text.split("\n")) pushTranscript(line);
          }
        } else if (type !== "reasoning") {
          const tool = toolPreview(item);
          if (tool) {
            emit({
              type: "activity",
              preview: `${item.status === "failed" ? "✗" : "✓"} ${tool.name}`,
            });
          }
        }
        break;
      }
      case "thread/tokenUsage/updated": {
        const usage = parseTokenUsage(params);
        if (usage.tokens !== undefined) state.tokens = usage.tokens;
        if (usage.contextWindow !== undefined) {
          state.contextWindow = usage.contextWindow;
        }
        break;
      }
      case "error": {
        const text = str(rec(params.error)?.message) ?? "Codex run failed";
        if (params.willRetry !== true) state.runError = text.slice(0, 4096);
        break;
      }
      case "turn/completed": {
        const turn = rec(params.turn);
        const status = str(turn?.status);
        const partialText = state.finalText || state.lastAssistantText || undefined;
        if (state.interruptRequested || status === "interrupted") {
          settle({ kind: "interrupted", partialText });
        } else if (status === "failed" || state.runError) {
          settle({
            kind: "failed",
            errorText:
              state.runError ??
              str(rec(turn?.error)?.message)?.slice(0, 4096) ??
              "Codex run failed",
            partialText,
          });
        } else {
          settle({
            kind: "completed",
            finalText: state.finalText || state.lastAssistantText,
          });
        }
        state.runError = undefined;
        break;
      }
    }
  };

  const handleServerRequest = (message: JsonRecord) => {
    // Approvals should never arrive under never/danger-full-access;
    // reject anything that does so the server does not hang.
    write({
      id: message.id as number | string,
      error: {
        code: -32601,
        message: `Unsupported headless request: ${str(message.method) ?? "unknown"}`,
      },
    });
  };

  const parser = createLineParser((line) => {
    const message = parseJsonRecord(line);
    if (!message) return;
    if (message.id !== undefined && message.method === undefined) {
      const entry = pending.get(message.id as number);
      if (!entry) return;
      pending.delete(message.id as number);
      if (message.error !== undefined) {
        entry.reject(
          new Error(str(rec(message.error)?.message) ?? "codex request failed"),
        );
      } else {
        entry.resolve(rec(message.result) ?? {});
      }
    } else if (message.id !== undefined && message.method !== undefined) {
      handleServerRequest(message);
    } else if (message.method !== undefined) {
      handleNotification(message);
    }
  });

  child.stdout.on("data", (chunk: string) => {
    try {
      parser(chunk);
    } catch {
      child.kill("SIGKILL");
    }
  });

  const fail = (message: string) => {
    for (const entry of pending.values()) entry.reject(new Error(message));
    pending.clear();
    settle({
      kind: "failed",
      errorText: message,
      partialText: state.finalText || state.lastAssistantText || undefined,
    });
  };

  child.on("exit", () => {
    state.exited = true;
    if (!state.closed) fail("codex app-server exited.");
  });
  child.on("error", (error) => {
    state.exited = true;
    if (!state.closed) fail(`codex app-server failed: ${error.message}`);
  });

  // --- Handshake + thread ---
  try {
    await request("initialize", {
      clientInfo: { name: "pi-subagents", title: "pi subagent", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    write({ method: "initialized" });
    const started = await request("thread/start", {
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: false,
      ...(options.model ? { model: options.model } : {}),
    });
    state.threadId = str(rec(started.thread)?.id);
    const model = str(started.model);
    if (model) state.modelLabel = `codex/${model}`;
    if (!state.threadId) throw new Error("codex thread/start returned no thread id.");
  } catch (error) {
    child.kill("SIGKILL");
    throw error instanceof Error ? error : new Error(String(error));
  }

  const effort = codexEffort(options.thinking);

  const startRun = (text: string) => {
    if (state.closed || !state.settled) return;
    state.settled = false;
    state.runError = undefined;
    state.finalText = "";
    state.lastAssistantText = "";
    state.interruptRequested = false;
    emit({ type: "run-started" });
    pushTranscript(`> ${text.split("\n")[0]}`);
    void request("turn/start", {
      threadId: state.threadId,
      input: [{ type: "text", text, text_elements: [] }],
      ...(effort ? { effort } : {}),
    }).then(
      (result) => {
        state.activeTurnId = str(rec(result.turn)?.id) ?? state.activeTurnId;
      },
      (error) => {
        settle({
          kind: "failed",
          errorText: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
        });
      },
    );
  };

  return {
    sessionFile: undefined,
    get modelLabel() {
      return state.modelLabel;
    },
    thinkingLevel: effort,
    prompt: startRun,
    async steer(_text) {
      // app-server has no mid-turn steering; the manager only calls
      // steer while streaming, so queue it as the next run instead.
      throw new Error(
        "Codex subagents cannot be steered mid-run; wait for the run to settle, then send again.",
      );
    },
    isStreaming: () => !state.settled,
    async interrupt() {
      if (state.closed || state.settled) return;
      state.interruptRequested = true;
      if (state.threadId && state.activeTurnId) {
        void request(
          "turn/interrupt",
          { threadId: state.threadId, turnId: state.activeTurnId },
          INTERRUPT_FALLBACK_MS,
        ).catch(() => {});
      }
      state.interruptTimer = setTimeout(() => {
        settle({
          kind: "interrupted",
          partialText: state.finalText || state.lastAssistantText || undefined,
        });
      }, INTERRUPT_FALLBACK_MS);
      state.interruptTimer.unref?.();
    },
    async dispose() {
      if (state.closed) return;
      state.closed = true;
      if (state.interruptTimer) clearTimeout(state.interruptTimer);
      for (const entry of pending.values()) {
        entry.reject(new Error("codex session closed."));
      }
      pending.clear();
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (!state.exited) child.kill("SIGKILL");
      }, 2_000);
      killTimer.unref?.();
    },
    usage: () => ({ tokens: state.tokens, contextWindow: state.contextWindow }),
    finalText: () => state.finalText || state.lastAssistantText,
    transcriptTail: (lines) => state.transcript.slice(-lines),
  };
}
