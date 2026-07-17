/** All model-facing text for the workflow tool. */

import type { RunRecord } from "./src/artifacts.ts";

export const WORKFLOW_DESCRIPTION = `Run a JavaScript orchestration script that fans work out to isolated subagents across phases. Deterministic control flow (loops, fan-out, merging) lives in the script; LLM work lives in the agents it spawns.

ONLY call this when the user explicitly asked for a workflow / multi-agent orchestration, or approved your ask_user proposal to run one. Never launch one on your own judgment — workflows can spawn many agents and burn significant tokens.

Script format — must begin with a pure-literal meta export:
  export const meta = {
    name: 'find-bugs',
    description: 'One line, shown to the user',
    phases: [{ title: 'Find' }, { title: 'Verify' }],
  }
  // body: plain JavaScript, await allowed, return value = workflow result

Available in the script (nothing else — no imports, no fs, no network, no eval):
- agent(prompt, opts?) → Promise<string | object | null>. Spawns one subagent with its own fresh context; returns its final text, or the structured object when opts.schema (a JSON Schema) is given. Failed agents resolve to null — filter with .filter(Boolean). opts: { label?, phase?, agentType? ('explore' read-only / 'worker' full, default worker), model?, effort?, schema? }.
- parallel(thunks) → Promise<results>. Runs thunks concurrently (max 4 agents run at once globally); a thrown thunk becomes null.
- pipeline(items, ...stages) → per-item chained stages with NO barrier between stages; each stage gets (prev, originalItem, index); a throwing stage drops that item to null. Prefer pipeline over parallel-then-parallel.
- phase(title), log(message) — progress reporting to the user.
- args — the tool call's args value, frozen.
- Caps: 32 agent() calls per run. Math.random(), Date.now(), and argless new Date() throw (they would break future resume) — pass timestamps/randomness via args.

Write self-contained agent prompts: children see nothing of this conversation. Use schema for any result you will merge or filter in code.

Inputs: pass exactly one of script (inline) or name (saved workflow from .pi/workflows/ or .claude/workflows/). background: true returns the runId immediately and delivers the result when done.`;

export const WORKFLOW_PROMPT_SNIPPET =
  "Run multi-agent orchestration scripts (workflows) when the user explicitly asks.";

export const WORKFLOW_PROMPT_GUIDELINES = [
  "Use the workflow tool only when the user explicitly requests a workflow or multi-agent orchestration; you may propose one via ask_user when a task would clearly benefit, and run it only if they agree.",
  "In workflow scripts, give every agent a fully self-contained prompt and use the schema option for results you will merge or filter in code.",
];

export const PARAMETER_DESCRIPTIONS = {
  script:
    "Inline workflow script: `export const meta = {...}` followed by the body. Mutually exclusive with name.",
  name: "Saved workflow name, resolved from .pi/workflows/<name>.js then .claude/workflows/<name>.js.",
  args: "Value exposed to the script as the global `args` (JSON-serializable).",
  background:
    "Run in the background: returns the runId immediately; the result arrives as a follow-up message when the run settles.",
};

export function buildRunResult(record: RunRecord, value: unknown, dir: string) {
  const lines = [
    `Workflow "${record.name}" ${record.status} — ${record.agentCount} agent(s), ${Math.round(((record.settledAt ?? Date.now()) - record.startedAt) / 1000)}s.`,
  ];
  if (record.error) lines.push(`Error: ${record.error}`);
  if (value !== undefined && value !== null) {
    let json: string;
    try {
      json = JSON.stringify(value, null, 2);
    } catch {
      json = String(value);
    }
    if (json.length > 24_000) {
      json = `${json.slice(0, 24_000)}\n…[clipped — full result in ${dir}/result.json]`;
    }
    lines.push("", "Result:", json);
  }
  lines.push("", `Artifacts: ${dir}`);
  return lines.join("\n");
}

export function buildBackgroundStartMessage(name: string, runId: string) {
  return `Workflow "${name}" started in the background as ${runId}. You will be notified with the result; /workflows shows progress.`;
}

export function buildBackgroundFailureMessage(
  name: string,
  runId: string,
  error: string,
) {
  return `Background workflow "${name}" (${runId}) failed before completing: ${error}`;
}
