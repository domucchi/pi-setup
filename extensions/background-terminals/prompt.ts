/** All model-facing text for the background-terminal tools. */

import type { TerminalEntry } from "./src/manager.ts";
import { tailText } from "./src/output.ts";

const STATUS_STDOUT_CHARS = 16_000;
const STATUS_STDERR_CHARS = 8_000;
const COMPLETION_TAIL_CHARS = 2_000;

export const BG_START_DESCRIPTION =
  "Start a long-running command in a background terminal and return immediately with its id. " +
  "The process keeps running while you continue working; you are notified once when it exits. " +
  "stdin is not available — never start anything that waits for interactive input.";

export const BG_START_PROMPT_SNIPPET =
  "Run long-lived commands (dev servers, watchers, builds) in background terminals.";

export const BG_START_PROMPT_GUIDELINES = [
  "Use bg_start instead of bash for anything long-running or blocking: dev servers, test watchers, builds, tails. Keep bash for commands that finish quickly.",
  "After bg_start, keep working; check on the process with bg_status only when its output matters for your next step.",
  "Background terminals have no stdin. For interactive programs, ask the user to run them instead.",
];

export const BG_STATUS_DESCRIPTION =
  "Inspect a background terminal: status, exit code, and recent stdout/stderr. " +
  "Full untruncated output is on disk at the paths included in the result.";

export const BG_LIST_DESCRIPTION =
  "List all background terminals with id, title, status, and runtime.";

export const BG_KILL_DESCRIPTION =
  "Kill background terminals by id (SIGTERM, escalating to SIGKILL after 2s, including child processes). " +
  "Returns after they have fully exited, with their final status.";

export const BG_PARAMETER_DESCRIPTIONS = {
  command: "Shell command to run (executed with /bin/sh -c).",
  title: "Short human-readable title, e.g. 'dev server'.",
  workingDir: "Working directory. Defaults to the current project directory.",
  statusId: "Id of the terminal to inspect, e.g. 'bg-1'.",
  killIds: "Ids of the terminals to kill.",
};

export function describeDuration(startedAt: number, settledAt: number | null) {
  const ms = (settledAt ?? Date.now()) - startedAt;
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}

export function describeOutcome(entry: TerminalEntry) {
  switch (entry.status) {
    case "running":
      return "running";
    case "done":
      return "done (exit 0)";
    case "killed":
      return `killed${entry.signal ? ` (${entry.signal})` : ""}`;
    case "failed":
      return entry.signal
        ? `failed (signal ${entry.signal})`
        : `failed (exit ${entry.exitCode ?? "unknown"})`;
  }
}

export function buildStartResult(entry: TerminalEntry) {
  const lines = [
    `Started ${entry.id} "${entry.title}" in ${entry.cwd}`,
    `You will be notified when it exits. Check on it with bg_status({ id: "${entry.id}" }).`,
  ];
  if (entry.spill) {
    lines.push(
      `Full output logs: ${entry.spill.stdoutPath} / ${entry.spill.stderrPath}`,
    );
  }
  return lines.join("\n");
}

export function buildStatusResult(entry: TerminalEntry) {
  const lines = [
    `${entry.id} "${entry.title}" — ${describeOutcome(entry)} after ${describeDuration(entry.startedAt, entry.settledAt)}`,
  ];
  const stdout = tailText(entry.stdout.text(), STATUS_STDOUT_CHARS);
  const stderr = tailText(entry.stderr.text(), STATUS_STDERR_CHARS);
  lines.push("", "stdout:", stdout || "(empty)");
  lines.push("", "stderr:", stderr || "(empty)");
  if (entry.spill) {
    lines.push(
      "",
      `Full logs: ${entry.spill.stdoutPath} / ${entry.spill.stderrPath}`,
    );
  }
  return lines.join("\n");
}

export function buildListResult(entries: TerminalEntry[]) {
  if (entries.length === 0) return "No background terminals.";
  return entries
    .map(
      (entry) =>
        `${entry.id}  ${describeOutcome(entry).padEnd(18)}  ${describeDuration(entry.startedAt, entry.settledAt).padStart(6)}  "${entry.title}"`,
    )
    .join("\n");
}

function truncateMiddleless(text: string, maxChars: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`;
}

function lastLines(text: string, count: number) {
  const lines = text.split("\n");
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines.slice(-count);
}

/** One picker row: id, state, runtime, title, and the actual command. */
export function buildPsLabel(entry: TerminalEntry) {
  const state =
    entry.status === "running" ? "●" : entry.status === "done" ? "✓" : "✗";
  return `${entry.id} ${state} ${describeOutcome(entry)} ${describeDuration(entry.startedAt, entry.settledAt)} · ${entry.title} · $ ${truncateMiddleless(entry.command, 48)}`;
}

/** Plain-text detail view body for /ps (styling applied by the caller). */
export function buildPsDetailLines(entry: TerminalEntry) {
  const lines = [
    `${entry.id} "${entry.title}" — ${describeOutcome(entry)} after ${describeDuration(entry.startedAt, entry.settledAt)}`,
    `$ ${entry.command}`,
    `cwd: ${entry.cwd}`,
    "",
  ];
  const stdout = lastLines(entry.stdout.text(), 15);
  lines.push(`stdout (last ${stdout.length} lines):`);
  lines.push(...(stdout.length > 0 ? stdout.map((l) => `  ${l}`) : ["  (empty)"]));
  const stderr = lastLines(entry.stderr.text(), 5);
  if (stderr.length > 0) {
    lines.push("", `stderr (last ${stderr.length} lines):`);
    lines.push(...stderr.map((l) => `  ${l}`));
  }
  if (entry.spill) {
    lines.push("", `logs: ${entry.spill.stdoutPath}`);
    lines.push(`      ${entry.spill.stderrPath}`);
  }
  return lines;
}

/** Follow-up message injected into the session when a terminal exits unnoticed. */
export function buildCompletionMessage(entry: TerminalEntry) {
  const lines = [
    `Background terminal ${entry.id} "${entry.title}" finished: ${describeOutcome(entry)} after ${describeDuration(entry.startedAt, entry.settledAt)}.`,
  ];
  const stderr = tailText(entry.stderr.text(), COMPLETION_TAIL_CHARS);
  const stdout = tailText(entry.stdout.text(), COMPLETION_TAIL_CHARS);
  if (entry.status !== "done" && stderr) {
    lines.push("", "stderr tail:", stderr);
  } else if (stdout) {
    lines.push("", "stdout tail:", stdout);
  }
  if (entry.spill) {
    lines.push(
      "",
      `Full logs: ${entry.spill.stdoutPath} / ${entry.spill.stderrPath}`,
    );
  }
  return lines.join("\n");
}
