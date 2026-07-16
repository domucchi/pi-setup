import { randomBytes, createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkflowMeta } from "./meta.ts";

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
}

/** Journal entry per agent() call — the future resume cache key+value. */
export interface JournalEntry {
  seq: number;
  promptHash: string;
  optsHash: string;
  label?: string;
  phase?: string;
  ok: boolean;
  error?: string;
  outputHead?: string;
}

export function workflowsRoot() {
  return path.join(getAgentDir(), "workflows");
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
  appendJournal(entry: JournalEntry): void;
}

export function createRunStore(runId: string): RunStore {
  const dir = path.join(workflowsRoot(), runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
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
    appendJournal(entry) {
      appendFileSync(path.join(dir, "journal.jsonl"), `${JSON.stringify(entry)}\n`);
    },
  };
}

/**
 * Past runs from disk, newest first. A run still marked "running" on
 * disk belongs to a dead process — normalize to "aborted".
 */
export function listRunsFromDisk(activeRunIds: ReadonlySet<string>): RunRecord[] {
  let ids: string[];
  try {
    ids = readdirSync(workflowsRoot()).filter((d) => d.startsWith("wf-"));
  } catch {
    return [];
  }
  const records: RunRecord[] = [];
  for (const id of ids) {
    try {
      const record = JSON.parse(
        readFileSync(path.join(workflowsRoot(), id, "workflow.json"), "utf8"),
      ) as RunRecord;
      if (record.status === "running" && !activeRunIds.has(record.runId)) {
        record.status = "aborted";
      }
      records.push(record);
    } catch {
      // Unreadable run dir: skip.
    }
  }
  return records.sort((a, b) => b.startedAt - a.startedAt);
}
