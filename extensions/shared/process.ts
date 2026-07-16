import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when output was capped by maxStdoutBytes and the process killed. */
  truncated: boolean;
}

export interface RunCommandOptions {
  /**
   * Kill the process once stdout reaches this many bytes, so a broad
   * search can't buffer unbounded memory. The captured stdout is kept.
   */
  maxStdoutBytes?: number;
}

function appendFailure(stderr: string, command: string, message: string) {
  const failure = `Failed to run ${command}: ${message}`;
  return stderr ? `${stderr.trimEnd()}\n${failure}` : failure;
}

/**
 * Run a command and always resolve: exit code on close, -1 on timeout
 * (process killed), 1 when spawning fails. Callers treat any nonzero
 * code as "no data", so this never throws.
 */
export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let truncated = false;
    let settled = false;

    const settle = (result: Omit<CommandResult, "truncated">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, truncated });
    };

    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ code: -1, stdout, stderr });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (truncated) return;
      stdout += chunk;
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (options.maxStdoutBytes && stdoutBytes >= options.maxStdoutBytes) {
        // Enough output captured — stop the process instead of buffering
        // an unbounded result (rg --max-count is per-file, not global).
        truncated = true;
        child.kill("SIGKILL");
        settle({ code: 0, stdout, stderr });
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      settle({
        code: 1,
        stdout,
        stderr: appendFailure(stderr, command, error.message),
      });
    });
    child.on("close", (code) => {
      settle({ code: code ?? 1, stdout, stderr });
    });
  });
}
