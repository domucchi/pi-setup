import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkflowMeta, WorkflowPhase } from "./meta.ts";
import type { ReplayEntry } from "./replay.ts";

export type RunStatus = "running" | "completed" | "failed" | "aborted";

export interface RunRecord {
  runId: string;
  name: string;
  description: string;
  status: RunStatus;
  startedAt: number;
  settledAt: number | null;
  agentCount: number;
  error?: string;
  resumedFrom?: string;
  /** Process that owns a running record. Absent on legacy records. */
  ownerPid?: number;
  /** Normalized project directory where the workflow originated. */
  cwd?: string;
  /** Pi session that created this run. Absent on legacy records. */
  sessionId?: string;
}

/**
 * Journal entry per agent() call — the resume cache key (seq + hashes)
 * plus a reference to the full recorded value (resultRef → agents/<seq>.json).
 * Replay serves resultRef for a matching (seq, promptHash, optsHash).
 */
export interface JournalEntry {
  seq: number;
  promptHash: string;
  optsHash: string;
  label?: string;
  phase?: string;
  ok: boolean;
  error?: string;
  outputHead?: string;
  resultRef?: string;
}

/** Full recorded outcome of one agent() call, keyed by seq for replay. */
export interface AgentResultArtifact {
  seq: number;
  ok: boolean;
  /** The full prompt the agent ran with — for inspection and replay. */
  prompt?: string;
  output?: string;
  structured?: unknown;
  error?: string;
}

export interface RehydratedAgent {
  seq: number;
  label: string;
  phase?: string;
  state: "ok" | "failed";
  prompt?: string;
  activity: string[];
  startedAt: number;
  error?: string;
  durationMs: number;
  output?: string;
}

export interface RehydratedRun {
  record: RunRecord;
  dir: string;
  phases?: WorkflowPhase[];
  agents: RehydratedAgent[];
}

export interface ResumeSource {
  record: RunRecord;
  source: string;
  args: unknown;
  replayEntries: ReplayEntry[];
}

export function workflowsRoot() {
  return path.join(getAgentDir(), "workflows");
}

export function normalizeWorkflowCwd(cwd: string) {
  const resolved = path.normalize(path.resolve(cwd));
  let normalized = resolved;
  try {
    normalized = realpathSync.native(resolved);
  } catch {
    // A missing legacy cwd will fail resume comparison unless it exactly
    // matches; settled runs remain inspectable regardless.
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isOwnerProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Persists — so random, per the ID rule (sequential is for in-session). */
export function newRunId() {
  return `wf-${randomBytes(4).toString("hex")}`;
}

export function hashForJournal(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
    .slice(0, 16);
}

function writeFileAtomic(file: string, content: string) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export interface RunStore {
  dir: string;
  saveInputs(source: string, args: unknown, meta: WorkflowMeta): void;
  saveStatus(record: RunRecord): void;
  saveResult(value: unknown): void;
  /** Persist one agent's full outcome; returns the journal resultRef. */
  saveAgentResult(artifact: AgentResultArtifact): string;
  appendJournal(entry: JournalEntry): void;
}

export function createRunStore(runId: string): RunStore {
  const dir = path.join(workflowsRoot(), runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const agentsDir = path.join(dir, "agents");
  return {
    dir,
    saveInputs(source, args, meta) {
      writeFileAtomic(path.join(dir, "script.js"), source);
      writeFileAtomic(path.join(dir, "args.json"), JSON.stringify(args ?? null, null, 2));
      writeFileAtomic(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    },
    saveStatus(record) {
      writeFileAtomic(path.join(dir, "workflow.json"), JSON.stringify(record, null, 2));
    },
    saveResult(value) {
      let text: string;
      try {
        text = JSON.stringify(value ?? null, null, 2);
      } catch {
        text = JSON.stringify(String(value));
      }
      writeFileAtomic(path.join(dir, "result.json"), text);
    },
    saveAgentResult(artifact) {
      mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
      const rel = `agents/${artifact.seq}.json`;
      writeFileAtomic(path.join(dir, rel), JSON.stringify(artifact, null, 2));
      return rel;
    },
    appendJournal(entry) {
      appendFileSync(path.join(dir, "journal.jsonl"), `${JSON.stringify(entry)}\n`);
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function parseRunRecord(value: unknown, expectedRunId: string): RunRecord | undefined {
  if (!isObject(value)) return undefined;
  if (
    value.runId !== expectedRunId ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    !["running", "completed", "failed", "aborted"].includes(String(value.status)) ||
    !isFiniteNumber(value.startedAt) ||
    !(value.settledAt === null || isFiniteNumber(value.settledAt)) ||
    !Number.isInteger(value.agentCount) ||
    (value.agentCount as number) < 0 ||
    !isOptionalString(value.error) ||
    !isOptionalString(value.resumedFrom) ||
    !(value.ownerPid === undefined ||
      (Number.isInteger(value.ownerPid) && (value.ownerPid as number) > 0)) ||
    !isOptionalString(value.cwd) ||
    !isOptionalString(value.sessionId)
  ) {
    return undefined;
  }
  return {
    runId: value.runId,
    name: value.name,
    description: value.description,
    status: value.status as RunStatus,
    startedAt: value.startedAt,
    settledAt: value.settledAt,
    agentCount: value.agentCount as number,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.resumedFrom === "string" ? { resumedFrom: value.resumedFrom } : {}),
    ...(typeof value.ownerPid === "number" ? { ownerPid: value.ownerPid } : {}),
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
  };
}

function parsePhases(value: unknown): WorkflowPhase[] | undefined {
  if (!isObject(value) || !Array.isArray(value.phases)) return undefined;
  const phases: WorkflowPhase[] = [];
  for (const item of value.phases) {
    if (!isObject(item) || typeof item.title !== "string") return undefined;
    if (!isOptionalString(item.detail) || !isOptionalString(item.model)) return undefined;
    phases.push({
      title: item.title,
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
      ...(typeof item.model === "string" ? { model: item.model } : {}),
    });
  }
  return phases;
}

function parseJournalEntry(value: unknown): JournalEntry | undefined {
  if (!isObject(value)) return undefined;
  if (
    !Number.isInteger(value.seq) ||
    (value.seq as number) < 1 ||
    typeof value.promptHash !== "string" ||
    typeof value.optsHash !== "string" ||
    typeof value.ok !== "boolean" ||
    !isOptionalString(value.label) ||
    !isOptionalString(value.phase) ||
    !isOptionalString(value.error) ||
    !isOptionalString(value.outputHead) ||
    !isOptionalString(value.resultRef)
  ) {
    return undefined;
  }
  return {
    seq: value.seq as number,
    promptHash: value.promptHash,
    optsHash: value.optsHash,
    ok: value.ok,
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.outputHead === "string" ? { outputHead: value.outputHead } : {}),
    ...(typeof value.resultRef === "string" ? { resultRef: value.resultRef } : {}),
  };
}

function parseAgentArtifact(
  value: unknown,
  expectedSeq: number,
): AgentResultArtifact | undefined {
  if (!isObject(value)) return undefined;
  if (
    value.seq !== expectedSeq ||
    typeof value.ok !== "boolean" ||
    !isOptionalString(value.prompt) ||
    !isOptionalString(value.output) ||
    !isOptionalString(value.error)
  ) {
    return undefined;
  }
  return {
    seq: expectedSeq,
    ok: value.ok,
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(typeof value.output === "string" ? { output: value.output } : {}),
    ...("structured" in value ? { structured: value.structured } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

interface LoadedJournal {
  entries: Map<number, JournalEntry>;
  /** False when any non-empty JSONL row is malformed, invalid, or duplicate. */
  replaySafe: boolean;
}

/** Valid journal rows keyed by sequence; all corruption is a replay barrier. */
function readJournal(dir: string): LoadedJournal {
  let text: string;
  try {
    text = readFileSync(path.join(dir, "journal.jsonl"), "utf8");
  } catch {
    return { entries: new Map(), replaySafe: false };
  }
  const entries = new Map<number, JournalEntry>();
  const duplicates = new Set<number>();
  let replaySafe = true;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = parseJournalEntry(JSON.parse(line) as unknown);
      if (!entry) {
        replaySafe = false;
        continue;
      }
      if (entries.has(entry.seq)) {
        replaySafe = false;
        duplicates.add(entry.seq);
        entries.delete(entry.seq);
      } else if (duplicates.has(entry.seq)) {
        replaySafe = false;
      } else {
        entries.set(entry.seq, entry);
      }
    } catch {
      replaySafe = false;
    }
  }
  return { entries, replaySafe };
}

function readAgentArtifact(dir: string, seq: number) {
  try {
    return parseAgentArtifact(
      readJson(path.join(dir, "agents", `${seq}.json`)),
      seq,
    );
  } catch {
    return undefined;
  }
}

function matchingAgentArtifact(dir: string, row: JournalEntry) {
  const expectedRef = `agents/${row.seq}.json`;
  if (row.resultRef !== expectedRef) return undefined;
  const artifact = readAgentArtifact(dir, row.seq);
  return artifact?.ok === row.ok ? artifact : undefined;
}

function replayPrefix(dir: string, journal: LoadedJournal) {
  if (!journal.replaySafe) return [];
  const entries: ReplayEntry[] = [];
  for (let seq = 1; ; seq += 1) {
    const row = journal.entries.get(seq);
    if (!row) break;
    const artifact = matchingAgentArtifact(dir, row);
    // Replay requires the full output, including the empty string used by
    // failed outcomes. A summary-only/corrupt artifact closes the prefix.
    if (!artifact || typeof artifact.output !== "string") break;
    entries.push({
      seq,
      promptHash: row.promptHash,
      optsHash: row.optsHash,
      outcome: {
        ok: artifact.ok,
        output: artifact.output,
        ...(artifact.structured !== undefined
          ? { structured: artifact.structured }
          : {}),
        ...(artifact.error !== undefined ? { error: artifact.error } : {}),
      },
    });
  }
  return entries;
}

/**
 * Load inspectable runs from disk, newest first. Runs left "running" by a
 * dead process are normalized to "aborted" and the normalization is written
 * back when possible. Unreadable run directories are skipped; incomplete
 * agent artifacts degrade to journal summaries.
 */
export function loadRunsFromDisk(
  activeRunIds: ReadonlySet<string>,
  root = workflowsRoot(),
  now = Date.now(),
  ownerIsAlive: (pid: number) => boolean = isOwnerProcessAlive,
  currentPid = process.pid,
  includeRecord: (record: RunRecord) => boolean = () => true,
): RehydratedRun[] {
  let ids: string[];
  try {
    ids = readdirSync(root).filter((id) => /^wf-[A-Za-z0-9_-]+$/.test(id));
  } catch {
    return [];
  }

  const runs: RehydratedRun[] = [];
  for (const id of ids) {
    const dir = path.join(root, id);
    try {
      const record = parseRunRecord(readJson(path.join(dir, "workflow.json")), id);
      if (!record || !includeRecord(record)) continue;
      let changed = false;
      if (record.status === "running") {
        if (activeRunIds.has(id)) continue;
        // A live owner belongs to another extension/runtime. Do not expose it
        // as a locally stoppable run and never rewrite its status.
        if (
          record.ownerPid !== undefined &&
          record.ownerPid !== currentPid &&
          ownerIsAlive(record.ownerPid)
        ) {
          continue;
        }
        record.status = "aborted";
        record.settledAt ??= now;
        record.error ??= "Workflow process ended before the run settled.";
        changed = true;
      }

      let phases: WorkflowPhase[] | undefined;
      try {
        phases = parsePhases(readJson(path.join(dir, "meta.json")));
      } catch {
        // Missing/corrupt meta only removes declared phase headings.
      }

      const journal = readJournal(dir);
      const durationMs = Math.max(
        0,
        (record.settledAt ?? record.startedAt) - record.startedAt,
      );
      const agents = [...journal.entries.values()]
        .sort((a, b) => a.seq - b.seq)
        .map((row): RehydratedAgent => {
          const artifact = matchingAgentArtifact(dir, row);
          return {
            seq: row.seq,
            label: row.label ?? `agent-${row.seq}`,
            ...(row.phase !== undefined ? { phase: row.phase } : {}),
            state: row.ok ? "ok" : "failed",
            ...(artifact?.prompt !== undefined ? { prompt: artifact.prompt } : {}),
            activity: [],
            startedAt: record.startedAt,
            ...((artifact?.error ?? row.error) !== undefined
              ? { error: artifact?.error ?? row.error }
              : {}),
            durationMs,
            ...((artifact?.output ?? row.outputHead) !== undefined
              ? { output: artifact?.output ?? row.outputHead }
              : {}),
          };
        });
      if (record.agentCount < agents.length) {
        record.agentCount = agents.length;
        changed = true;
      }
      if (changed) {
        try {
          writeFileAtomic(
            path.join(dir, "workflow.json"),
            JSON.stringify(record, null, 2),
          );
        } catch {
          // The in-memory normalization still makes the run inspectable.
        }
      }
      runs.push({ record, dir, phases, agents });
    } catch {
      // Unreadable run dir: skip.
    }
  }
  return runs.sort((a, b) => b.record.startedAt - a.record.startedAt);
}

/** Disk runs belonging to, or explicitly referenced by, one Pi session. */
export function loadSessionRunsFromDisk(
  activeRunIds: ReadonlySet<string>,
  sessionId: string,
  referencedRunIds: ReadonlySet<string>,
  root = workflowsRoot(),
  now = Date.now(),
  ownerIsAlive: (pid: number) => boolean = isOwnerProcessAlive,
  currentPid = process.pid,
) {
  return loadRunsFromDisk(
    activeRunIds,
    root,
    now,
    ownerIsAlive,
    currentPid,
    (record) =>
      record.sessionId === sessionId || referencedRunIds.has(record.runId),
  );
}

/** Backward-compatible record-only disk listing. */
export function listRunsFromDisk(
  activeRunIds: ReadonlySet<string>,
  root = workflowsRoot(),
) {
  return loadRunsFromDisk(activeRunIds, root).map((run) => run.record);
}

/** Read the immutable inputs and usable replay prefix for a source run. */
export function loadResumeSource(
  runId: string,
  currentCwd: string,
  root = workflowsRoot(),
): ResumeSource {
  if (!/^wf-[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error(`Invalid workflow run ID "${runId}".`);
  }
  const dir = path.join(root, runId);
  if (!existsSync(dir)) {
    throw new Error(`No stored workflow run "${runId}".`);
  }

  let record: RunRecord | undefined;
  try {
    record = parseRunRecord(readJson(path.join(dir, "workflow.json")), runId);
  } catch {
    // Converted to a stable, model-actionable error below.
  }
  if (!record) {
    throw new Error(`Cannot resume workflow "${runId}": workflow.json is unreadable.`);
  }
  if (record.status === "running") {
    throw new Error(
      `Workflow "${runId}" is still marked running; wait for it to settle before resuming.`,
    );
  }
  if (record.cwd === undefined) {
    throw new Error(
      `Cannot resume workflow "${runId}": source run has no recorded cwd.`,
    );
  }
  if (!path.isAbsolute(record.cwd)) {
    throw new Error(
      `Cannot resume workflow "${runId}": source run has an invalid recorded cwd.`,
    );
  }
  if (normalizeWorkflowCwd(record.cwd) !== normalizeWorkflowCwd(currentCwd)) {
    throw new Error(
      `Cannot resume workflow "${runId}": source cwd ${record.cwd} does not match current cwd ${normalizeWorkflowCwd(currentCwd)}.`,
    );
  }

  let source: string;
  try {
    source = readFileSync(path.join(dir, "script.js"), "utf8");
  } catch {
    throw new Error(`Cannot resume workflow "${runId}": script.js is unreadable.`);
  }

  let args: unknown;
  try {
    args = readJson(path.join(dir, "args.json"));
  } catch {
    throw new Error(`Cannot resume workflow "${runId}": args.json is unreadable.`);
  }

  const journal = readJournal(dir);
  return { record, source, args, replayEntries: replayPrefix(dir, journal) };
}
