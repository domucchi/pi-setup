/**
 * Pure layout/formatting logic for the workflow dashboard. Everything
 * here is theme-free and testable; dashboard.ts applies colors.
 * Generic formatting (tokens, durations, windowing) lives in
 * extensions/shared/agent-format.ts.
 */

import {
  formatTokens,
  shortModel,
} from "../../shared/agent-format.ts";
import type { WorkflowPhase } from "./meta.ts";

/** Per-agent data the dashboard renders (mirrors workflows' ActiveAgent). */
export interface AgentView {
  seq: number;
  label: string;
  phase?: string;
  state: "running" | "ok" | "failed";
  prompt?: string;
  agentType?: string;
  model?: string;
  tokens?: number;
  contextWindow?: number;
  toolCalls?: number;
  /** Recent tool-call previews, newest last. */
  activity: string[];
  startedAt: number;
  error?: string;
  durationMs?: number;
  /** Head of the agent's return value (full text in the run's artifacts). */
  output?: string;
}

export interface PhaseGroup {
  title: string;
  detail?: string;
  agents: AgentView[];
}

export const UNPHASED_TITLE = "unphased";

/**
 * meta.phases in declared order (kept even while still empty), then any
 * phase titles that only exist on agents (first-seen order), then a
 * trailing group for agents without a phase — only when it has members.
 * A workflow that never uses phases collapses to a single "Agents" group.
 */
export function groupAgentsByPhase(
  phases: WorkflowPhase[] | undefined,
  agents: AgentView[],
): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  const byTitle = new Map<string, PhaseGroup>();
  const add = (title: string, detail?: string) => {
    const group: PhaseGroup = { title, detail, agents: [] };
    groups.push(group);
    byTitle.set(title, group);
    return group;
  };
  for (const phase of phases ?? []) {
    if (!byTitle.has(phase.title)) add(phase.title, phase.detail);
  }
  const unphased: AgentView[] = [];
  for (const agent of agents) {
    if (!agent.phase) {
      unphased.push(agent);
      continue;
    }
    (byTitle.get(agent.phase) ?? add(agent.phase)).agents.push(agent);
  }
  if (unphased.length > 0) {
    add(groups.length === 0 ? "Agents" : UNPHASED_TITLE).agents.push(...unphased);
  }
  return groups;
}

export interface GroupCounts {
  total: number;
  done: number;
  failed: number;
  running: number;
}

export function groupCounts(agents: AgentView[]): GroupCounts {
  const counts: GroupCounts = {
    total: agents.length,
    done: 0,
    failed: 0,
    running: 0,
  };
  for (const agent of agents) {
    if (agent.state === "running") counts.running += 1;
    else if (agent.state === "ok") counts.done += 1;
    else counts.failed += 1;
  }
  return counts;
}

export function agentElapsedMs(agent: AgentView, now: number): number {
  return agent.durationMs ?? Math.max(0, now - agent.startedAt);
}

/** "gpt-5.6-sol · 12.3k tok · 4 tools" — only the parts that are known. */
export function agentStats(agent: AgentView): string {
  const parts: string[] = [];
  if (agent.model) parts.push(shortModel(agent.model));
  const tokens = formatTokens(agent.tokens);
  if (tokens) parts.push(tokens);
  if (agent.toolCalls) {
    parts.push(`${agent.toolCalls} tool${agent.toolCalls === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function aggregateTokens(agents: AgentView[]): number | undefined {
  let sum: number | undefined;
  for (const agent of agents) {
    if (agent.tokens !== undefined) sum = (sum ?? 0) + agent.tokens;
  }
  return sum;
}

export type RunStatusWord = "running" | "done" | "failed" | "aborted";

export function statusWord(
  status: "running" | "completed" | "failed" | "aborted",
): RunStatusWord {
  return status === "completed" ? "done" : status;
}

/** Theme color key per run status. */
export function statusColorKey(
  status: "running" | "completed" | "failed" | "aborted",
): "warning" | "success" | "error" | "muted" {
  switch (status) {
    case "running":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "aborted":
      return "muted";
  }
}

export function stateIcon(state: AgentView["state"]): string {
  return state === "running" ? "◆" : state === "ok" ? "✓" : "✗";
}

/** Theme color key per agent state. */
export function stateColorKey(
  state: AgentView["state"],
): "warning" | "success" | "error" {
  return state === "running" ? "warning" : state === "ok" ? "success" : "error";
}
