import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CHILD_PATH = fileURLToPath(new URL("./sandbox-child.cjs", import.meta.url));
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_ARGS_BYTES = 256 * 1024;
const MAX_CHILD_MESSAGE_BYTES = 600 * 1024; // agent budget + envelope slack
const READY_TIMEOUT_MS = 10_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1_000;

export interface SandboxAgentRequest {
  id: number;
  prompt: string;
  opts: {
    label?: string;
    phase?: string;
    model?: string;
    agentType?: string;
    effort?: string;
    thinking?: string;
    schema?: unknown;
  };
}

export interface SandboxAgentOutcome {
  ok: boolean;
  output: string;
  structured?: unknown;
  error?: string;
}

export interface SandboxHandlers {
  onPhase(title: string): void;
  onLog(message: string): void;
  runAgent(request: SandboxAgentRequest): Promise<SandboxAgentOutcome>;
}

export type SandboxResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * Run a workflow script body in a permission-restricted Node child:
 * read-only fs limited to the sandbox directory, no network, no child
 * processes, 128MB heap, token-authenticated IPC. The script can only
 * talk to us — every capability flows through `handlers`.
 */
export function runWorkflowSandbox(options: {
  body: string;
  args: unknown;
  maxAgentCalls: number;
  handlers: SandboxHandlers;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const token = randomBytes(24).toString("hex");
    let settled = false;
    let ready = false;

    if (Buffer.byteLength(options.body, "utf8") > MAX_SOURCE_BYTES) {
      resolve({ ok: false, error: "Workflow script exceeds the 512KB source budget." });
      return;
    }
    let argsJson: string;
    try {
      argsJson = JSON.stringify(options.args ?? null);
    } catch {
      resolve({ ok: false, error: "Workflow args must be JSON-serializable." });
      return;
    }
    if (argsJson.length > MAX_ARGS_BYTES) {
      resolve({ ok: false, error: "Workflow args exceed the 256KB budget." });
      return;
    }

    const child = spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${path.dirname(CHILD_PATH)}`,
        "--max-old-space-size=128",
        "--stack-size=2048",
        CHILD_PATH,
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );

    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      timers.push(timer);
    };

    const finish = (result: SandboxResult) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      for (const timer of timers) clearTimeout(timer);
      killTree();
      resolve(result);
    };

    const killTree = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
      later(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }, 1_000);
    };

    const onAbort = () => finish({ ok: false, error: "Workflow run was aborted." });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    later(() => {
      if (!ready) finish({ ok: false, error: "Workflow sandbox failed to start (is Node's --permission flag available?)." });
    }, READY_TIMEOUT_MS);
    later(
      () => finish({ ok: false, error: "Workflow run timed out." }),
      options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    );

    child.on("error", (error) => {
      finish({ ok: false, error: `Sandbox process error: ${error.message}` });
    });
    child.on("exit", (code) => {
      if (!settled) {
        finish({
          ok: false,
          error: `Sandbox exited unexpectedly (code ${code ?? "unknown"}).`,
        });
      }
    });

    child.on("message", (raw: unknown) => {
      if (settled) return;
      const message = raw as Record<string, unknown>;
      if (
        !message ||
        typeof message !== "object" ||
        message.token !== token ||
        typeof message.kind !== "string"
      ) {
        finish({ ok: false, error: "Sandbox protocol violation (bad message envelope)." });
        return;
      }
      let size: number;
      try {
        size = JSON.stringify(message).length;
      } catch {
        finish({ ok: false, error: "Sandbox protocol violation (unserializable message)." });
        return;
      }
      if (size > MAX_CHILD_MESSAGE_BYTES && message.kind !== "result") {
        finish({ ok: false, error: "Sandbox protocol violation (message over budget)." });
        return;
      }

      switch (message.kind) {
        case "ready":
          ready = true;
          break;
        case "phase":
          if (typeof message.title === "string") options.handlers.onPhase(message.title);
          break;
        case "log":
          if (typeof message.message === "string") options.handlers.onLog(message.message);
          break;
        case "agent": {
          if (typeof message.id !== "number" || typeof message.prompt !== "string") {
            finish({ ok: false, error: "Sandbox protocol violation (bad agent request)." });
            return;
          }
          const request: SandboxAgentRequest = {
            id: message.id,
            prompt: message.prompt,
            opts: (message.opts ?? {}) as SandboxAgentRequest["opts"],
          };
          options.handlers
            .runAgent(request)
            .then((outcome) => {
              if (settled) return;
              child.send({
                token,
                kind: "agent-result",
                id: request.id,
                ok: outcome.ok,
                output: outcome.output,
                structured: outcome.structured,
                error: outcome.error,
              });
            })
            .catch((error) => {
              if (settled) return;
              child.send({
                token,
                kind: "agent-result",
                id: request.id,
                ok: false,
                output: "",
                error: error instanceof Error ? error.message : String(error),
              });
            });
          break;
        }
        case "result":
          finish({ ok: true, value: message.value });
          break;
        case "error":
          finish({
            ok: false,
            error: typeof message.message === "string" ? message.message : "Workflow failed.",
          });
          break;
        default:
          finish({ ok: false, error: `Sandbox protocol violation (kind ${message.kind}).` });
      }
    });

    child.send({
      kind: "init",
      token,
      body: options.body,
      args: JSON.parse(argsJson),
      maxAgentCalls: options.maxAgentCalls,
    });
  });
}
