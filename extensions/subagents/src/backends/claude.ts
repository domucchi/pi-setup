/**
 * claude backend — Claude Code as a subagent via the Agent SDK.
 *
 * One `query()` in streaming-input mode lives for the whole child:
 * prompt()/steer() push user messages into the input bridge (the CLI
 * queues mid-run sends), the message stream is folded into ChildEvents,
 * and each `result` message settles the current run. Runs with
 * bypassPermissions by explicit user decision — real isolation is a
 * later, separate concern.
 */

import type { ChildEvent, ChildHandle, RunOutcome } from "../child.ts";

const FIRST_MESSAGE_WATCHDOG_MS = 90_000;
const TRANSCRIPT_MAX_LINES = 200;
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Clamp a pi thinking level to Claude Code's effort scale (or omit). */
export function claudeEffort(
  thinking: string | undefined,
): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (!thinking) return undefined;
  if (CLAUDE_EFFORTS.has(thinking)) {
    return thinking as "low" | "medium" | "high" | "xhigh" | "max";
  }
  if (thinking === "off" || thinking === "minimal") return "low";
  return undefined;
}

export interface ExternalChildOptions {
  cwd: string;
  model?: string;
  thinking?: string;
  appendSystemPrompt?: string;
  sessionName: string;
  onEvent: (event: ChildEvent) => void;
}

/** What one SDK message means for our child state (pure, testable). */
export interface ClaudeInterpretation {
  /** Tool-call previews, e.g. "→ Edit". */
  activities: string[];
  /** Lines for the transcript tail. */
  transcript: string[];
  modelLabel?: string;
  /** Present when this message settles the current run. */
  settled?: RunOutcome;
  /** Approximate context tokens from the result usage. */
  tokens?: number;
}

export function interpretClaudeMessage(
  message: Record<string, any>,
): ClaudeInterpretation {
  const out: ClaudeInterpretation = { activities: [], transcript: [] };
  switch (message.type) {
    case "system": {
      if (message.subtype === "init" && typeof message.model === "string") {
        out.modelLabel = `claude/${message.model}`;
      }
      break;
    }
    case "assistant": {
      const content = message.message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
          out.transcript.push(...block.text.trim().split("\n"));
        } else if (block?.type === "tool_use" && typeof block.name === "string") {
          out.activities.push(`→ ${block.name}`);
          out.transcript.push(`  → ${block.name}`);
        }
      }
      break;
    }
    case "result": {
      const usage = message.usage as Record<string, number> | undefined;
      if (usage) {
        out.tokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.output_tokens ?? 0);
      }
      const text = typeof message.result === "string" ? message.result : "";
      if (message.subtype === "success" && message.is_error !== true) {
        out.settled = { kind: "completed", finalText: text };
      } else {
        out.settled = {
          kind: "failed",
          errorText: (text || `Claude run failed (${message.subtype ?? "unknown"})`).slice(0, 4096),
          partialText: text || undefined,
        };
      }
      break;
    }
  }
  return out;
}

interface SdkUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
}

function createInputBridge() {
  const queue: SdkUserMessage[] = [];
  let notify: (() => void) | undefined;
  let ended = false;
  return {
    push(text: string) {
      queue.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
      notify?.();
    },
    end() {
      ended = true;
      notify?.();
    },
    iterable: (async function* () {
      for (;;) {
        while (queue.length > 0) yield queue.shift()!;
        if (ended) return;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = undefined;
      }
    })(),
  };
}

export async function createClaudeChild(
  options: ExternalChildOptions,
): Promise<ChildHandle> {
  // Lazy import: the SDK is only paid for when a claude child spawns.
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const bridge = createInputBridge();
  const state = {
    closed: false,
    settled: true,
    modelLabel: options.model ? `claude/${options.model}` : undefined,
    tokens: undefined as number | undefined,
    finalText: "",
    transcript: [] as string[],
    watchdog: undefined as ReturnType<typeof setTimeout> | undefined,
  };

  const emit = (event: ChildEvent) => {
    if (!state.closed) options.onEvent(event);
  };

  const clearWatchdog = () => {
    if (state.watchdog) clearTimeout(state.watchdog);
    state.watchdog = undefined;
  };

  const settle = (outcome: RunOutcome) => {
    if (state.settled) return;
    state.settled = true;
    clearWatchdog();
    if (outcome.kind === "completed") state.finalText = outcome.finalText;
    else if (outcome.partialText) state.finalText = outcome.partialText;
    emit({ type: "run-settled", outcome });
  };

  const effort = claudeEffort(options.thinking);
  const stream = query({
    prompt: bridge.iterable as AsyncIterable<never>,
    options: {
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      ...(effort ? { effort } : {}),
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(options.appendSystemPrompt
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: options.appendSystemPrompt,
            },
          }
        : {}),
    },
  });

  // Fold the SDK message stream into child state/events for the whole
  // child lifetime; ends when the bridge ends or the CLI dies.
  void (async () => {
    try {
      for await (const message of stream) {
        if (state.closed) break;
        clearWatchdog();
        const meaning = interpretClaudeMessage(message as Record<string, any>);
        if (meaning.modelLabel) state.modelLabel = meaning.modelLabel;
        if (meaning.tokens !== undefined) state.tokens = meaning.tokens;
        for (const line of meaning.transcript) {
          state.transcript.push(line);
        }
        if (state.transcript.length > TRANSCRIPT_MAX_LINES) {
          state.transcript.splice(0, state.transcript.length - TRANSCRIPT_MAX_LINES);
        }
        for (const activity of meaning.activities) {
          emit({ type: "activity", preview: activity });
        }
        if (meaning.settled) settle(meaning.settled);
      }
      settle({ kind: "failed", errorText: "Claude session ended unexpectedly." });
    } catch (error) {
      settle({
        kind: "failed",
        errorText: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
      });
    }
  })();

  const startRun = (text: string) => {
    state.settled = false;
    emit({ type: "run-started" });
    clearWatchdog();
    state.watchdog = setTimeout(() => {
      settle({
        kind: "failed",
        errorText: `No response from Claude within ${FIRST_MESSAGE_WATCHDOG_MS / 1000}s.`,
      });
    }, FIRST_MESSAGE_WATCHDOG_MS);
    state.watchdog.unref?.();
    state.transcript.push(`> ${text.split("\n")[0]}`);
    bridge.push(text);
  };

  return {
    sessionFile: undefined,
    get modelLabel() {
      return state.modelLabel;
    },
    thinkingLevel: effort,
    prompt: startRun,
    async steer(text) {
      // The CLI queues mid-run user messages natively.
      state.transcript.push(`> ${text.split("\n")[0]}`);
      bridge.push(text);
    },
    isStreaming: () => !state.settled,
    async interrupt() {
      if (state.closed) return;
      await stream.interrupt().catch(() => {});
      settle({ kind: "interrupted", partialText: state.finalText || undefined });
    },
    async dispose() {
      if (state.closed) return;
      state.closed = true;
      clearWatchdog();
      bridge.end();
      if (!state.settled) {
        await stream.interrupt().catch(() => {});
      }
      state.settled = true;
    },
    usage: () => ({ tokens: state.tokens, contextWindow: undefined }),
    finalText: () => state.finalText,
    transcriptTail: (lines) => state.transcript.slice(-lines),
  };
}
