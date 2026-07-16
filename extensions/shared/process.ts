import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
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
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
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
      stdout += chunk;
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
