/** All model-facing text for the subagent tools. */

import type { AgentDefinition } from "./src/agents.ts";
import type { SubagentSnapshot } from "./src/manager.ts";

const WAIT_TOTAL_BUDGET_CHARS = 48_000;
const WAIT_PER_AGENT_CHARS = 16_000;

export const SPAWN_DESCRIPTION =
  "Spawn a subagent: an autonomous agent with its own fresh context that works on a task and reports back. " +
  "It cannot see this conversation, cannot ask the user, and cannot spawn subagents — " +
  "give it a fully self-contained prompt (paths, constraints, expected report). " +
  "Returns immediately with an id; you are notified when it finishes.";

export const SPAWN_PROMPT_SNIPPET =
  "Delegate self-contained tasks to subagents (own context window, parallel).";

export const SPAWN_PROMPT_GUIDELINES = [
  "Delegate to subagents when a task is self-contained and its full output would pollute your context (broad searches, bulk edits, independent investigations), or when tasks can run in parallel.",
  "Write self-contained subagent prompts: the child sees nothing of this conversation — include paths, constraints, and the exact report you expect.",
  "After spawning, continue useful work; call subagent_wait only when you need the results to proceed.",
  "Use subagent_send to give follow-up instructions or feedback to a running or finished subagent — it keeps its context.",
];

export const SEND_DESCRIPTION =
  "Send a message to a subagent. Steers it mid-run, or starts a new run on a finished one (it keeps its context). " +
  "Use for follow-ups, corrections, or 'now verify your work'. Cancelled subagents cannot receive messages.";

export const WAIT_DESCRIPTION =
  "Block until the listed subagents finish their current run, then return their reports. " +
  "Only call when results are required to proceed.";

export const CHECK_DESCRIPTION =
  "Peek at one subagent without blocking: status, last activity, and a report preview.";

export const CANCEL_DESCRIPTION =
  "Cancel subagents: interrupts the current run and disposes the child session permanently.";

export const LIST_DESCRIPTION =
  "List all subagents with id, status, agent type, and title.";

export const PARAMETER_DESCRIPTIONS = {
  prompt:
    "Fully self-contained task prompt: context, file paths, constraints, and the expected report format.",
  title: "Short human-readable title, e.g. 'audit auth module'.",
  agentType:
    "Named role from agents/*.md (e.g. 'explore' for read-only scouting, 'worker' for full-tool work). Defaults to worker.",
  model:
    "Model override: 'provider/model-id', or a bare id when unambiguous. Defaults to inheriting this session's model.",
  reasoningEffort:
    "Thinking level: off, minimal, low, medium, high, xhigh, or max. Defaults to inheriting this session's level.",
  workingDir: "Working directory. Defaults to the current project directory.",
  sendId: "Id of the subagent to message.",
  sendMessage: "The follow-up instruction or feedback.",
  waitIds: "Ids of the subagents to wait for.",
  checkId: "Id of the subagent to inspect.",
  cancelIds: "Ids of the subagents to cancel.",
};

export function describeStatus(snapshot: SubagentSnapshot) {
  switch (snapshot.status) {
    case "working":
      return snapshot.lastActivity
        ? `working (${snapshot.lastActivity})`
        : "working";
    case "idle":
      return snapshot.errorText === "interrupted" ? "interrupted" : "finished";
    case "failed":
      return `failed (${snapshot.errorText ?? "unknown error"})`;
    case "cancelled":
      return "cancelled";
  }
}

export function describeDuration(startedAt: number, settledAt: number | null) {
  const ms = (settledAt ?? Date.now()) - startedAt;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}

function clip(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[report clipped — use subagent_check for the tail]`;
}

export function buildSpawnResult(snapshot: SubagentSnapshot) {
  return [
    `Spawned ${snapshot.id} (${snapshot.agentType}) "${snapshot.title}" in ${snapshot.cwd}.`,
    `You will be notified when it finishes. subagent_wait({ ids: ["${snapshot.id}"] }) blocks for the report; keep working in the meantime.`,
  ].join("\n");
}

export function buildWaitResult(snapshots: SubagentSnapshot[]) {
  if (snapshots.length === 0) return "No matching subagents.";
  const perAgent = Math.min(
    WAIT_PER_AGENT_CHARS,
    Math.floor(WAIT_TOTAL_BUDGET_CHARS / snapshots.length),
  );
  return snapshots
    .map((snapshot) => {
      const header = `## ${snapshot.id} "${snapshot.title}" — ${describeStatus(snapshot)} after ${describeDuration(snapshot.startedAt, snapshot.settledAt)}`;
      const body = snapshot.finalText
        ? clip(snapshot.finalText, perAgent)
        : "(no report text)";
      return `${header}\n${body}`;
    })
    .join("\n\n");
}

export function describeRuntime(snapshot: SubagentSnapshot) {
  const parts: string[] = [];
  if (snapshot.model) parts.push(snapshot.model);
  if (snapshot.thinking) parts.push(`thinking ${snapshot.thinking}`);
  return parts.join(" · ");
}

export function buildCheckResult(snapshot: SubagentSnapshot) {
  const lines = [
    `${snapshot.id} (${snapshot.agentType}) "${snapshot.title}" — ${describeStatus(snapshot)} after ${describeDuration(snapshot.startedAt, snapshot.settledAt)}, run ${snapshot.runs}`,
  ];
  const runtime = describeRuntime(snapshot);
  if (runtime) lines.push(runtime);
  if (snapshot.tokens !== null && snapshot.contextWindow) {
    lines.push(
      `context: ${Math.round((snapshot.tokens / snapshot.contextWindow) * 100)}% of ${Math.round(snapshot.contextWindow / 1000)}k`,
    );
  }
  if (snapshot.finalText) {
    lines.push("", clip(snapshot.finalText, 2_000));
  }
  return lines.join("\n");
}

export function buildListResult(snapshots: SubagentSnapshot[]) {
  if (snapshots.length === 0) return "No subagents.";
  return snapshots
    .map(
      (s) =>
        `${s.id}  ${describeStatus(s).padEnd(24)}  ${s.agentType.padEnd(8)}  ${describeDuration(s.startedAt, s.settledAt).padStart(6)}  "${s.title}"`,
    )
    .join("\n");
}

/** Follow-up message injected when a run settles unnoticed. */
export function buildCompletionMessage(snapshot: SubagentSnapshot) {
  const header = `Subagent ${snapshot.id} "${snapshot.title}" ${describeStatus(snapshot)} after ${describeDuration(snapshot.startedAt, snapshot.settledAt)}.`;
  const body = snapshot.finalText
    ? clip(snapshot.finalText, WAIT_PER_AGENT_CHARS)
    : "(no report text)";
  return `${header}\n\n${body}`;
}

export function buildAgentTypeError(
  requested: string,
  available: Map<string, AgentDefinition>,
) {
  const list = [...available.values()]
    .map((d) => `- ${d.name}: ${d.description}`)
    .join("\n");
  return `Unknown agent type "${requested}". Available:\n${list}`;
}
