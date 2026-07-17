import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadResumeSource,
  loadRunsFromDisk,
  loadSessionRunsFromDisk,
} from "./src/artifacts.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root() {
  const value = mkdtempSync(path.join(tmpdir(), "workflow-artifacts-"));
  roots.push(value);
  return value;
}

function writeJson(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function createRun(
  base: string,
  runId: string,
  status = "completed",
  overrides: Record<string, unknown> = {},
) {
  const dir = path.join(base, runId);
  mkdirSync(path.join(dir, "agents"), { recursive: true });
  writeJson(path.join(dir, "workflow.json"), {
    runId,
    name: "disk-run",
    description: "loaded from artifacts",
    status,
    startedAt: 1_000,
    settledAt: status === "running" ? null : 5_000,
    agentCount: 1,
    cwd: base,
    ...overrides,
  });
  writeJson(path.join(dir, "meta.json"), {
    name: "disk-run",
    description: "loaded from artifacts",
    phases: [{ title: "Find" }, { title: "Verify", detail: "again" }],
  });
  writeFileSync(
    path.join(dir, "script.js"),
    "export const meta = { name: 'disk-run', description: 'loaded' }; return args.value;",
  );
  writeJson(path.join(dir, "args.json"), { value: 42 });
  return dir;
}

function journalRow(
  seq: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    seq,
    promptHash: `prompt-${seq}`,
    optsHash: `opts-${seq}`,
    label: `agent-${seq}`,
    phase: seq === 1 ? "Find" : "Verify",
    ok: true,
    resultRef: `agents/${seq}.json`,
    ...overrides,
  };
}

describe("workflow artifact loading", () => {
  it("rehydrates phases and settled rows, persisting stale-running normalization", () => {
    const base = root();
    const dir = createRun(base, "wf-stale", "running");
    writeFileSync(
      path.join(dir, "journal.jsonl"),
      `${JSON.stringify(journalRow(2, {
        ok: false,
        error: "failed summary",
        outputHead: "partial",
      }))}\n${JSON.stringify(journalRow(1))}\n`,
    );
    writeJson(path.join(dir, "agents", "1.json"), {
      seq: 1,
      ok: true,
      prompt: "full prompt",
      output: "full output",
    });
    mkdirSync(path.join(base, "wf-corrupt"));
    writeFileSync(path.join(base, "wf-corrupt", "workflow.json"), "{");

    const runs = loadRunsFromDisk(new Set(), base, 9_000);

    expect(runs).toHaveLength(1);
    expect(runs[0].record).toMatchObject({
      runId: "wf-stale",
      status: "aborted",
      settledAt: 9_000,
      agentCount: 2,
    });
    expect(runs[0].phases).toEqual([
      { title: "Find" },
      { title: "Verify", detail: "again" },
    ]);
    expect(runs[0].agents.map((agent) => agent.seq)).toEqual([1, 2]);
    expect(runs[0].agents[0]).toMatchObject({
      state: "ok",
      prompt: "full prompt",
      output: "full output",
    });
    expect(runs[0].agents[1]).toMatchObject({
      state: "failed",
      error: "failed summary",
      output: "partial",
    });

    const persisted = JSON.parse(
      readFileSync(path.join(dir, "workflow.json"), "utf8"),
    ) as { status: string; settledAt: number; agentCount: number };
    expect(persisted).toMatchObject({
      status: "aborted",
      settledAt: 9_000,
      agentCount: 2,
    });
  });

  it("loads stored inputs and only the consecutive fully readable replay prefix", () => {
    const base = root();
    const dir = createRun(base, "wf-source");
    writeFileSync(
      path.join(dir, "journal.jsonl"),
      [journalRow(3), journalRow(1, { ok: false }), journalRow(2)]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    writeJson(path.join(dir, "agents", "1.json"), {
      seq: 1,
      ok: false,
      prompt: "failed prompt",
      output: "",
      error: "source failure",
    });
    // Missing output makes seq 2 unreadable for full-outcome replay. Seq 3
    // must not be used even though it has a complete artifact.
    writeJson(path.join(dir, "agents", "2.json"), { seq: 2, ok: true });
    writeJson(path.join(dir, "agents", "3.json"), {
      seq: 3,
      ok: true,
      output: "too late",
    });

    const source = loadResumeSource("wf-source", base, base);

    expect(source.args).toEqual({ value: 42 });
    expect(source.source).toContain("return args.value");
    expect(source.replayEntries).toEqual([
      {
        seq: 1,
        promptHash: "prompt-1",
        optsHash: "opts-1",
        outcome: { ok: false, output: "", error: "source failure" },
      },
    ]);
  });

  it("loads only runs owned or referenced by the current session", () => {
    const base = root();
    createRun(base, "wf-owned", "completed", { sessionId: "session-a" });
    createRun(base, "wf-referenced", "completed");
    createRun(base, "wf-unrelated", "completed", { sessionId: "session-b" });
    const unrelatedRunning = createRun(base, "wf-unrelated-running", "running", {
      sessionId: "session-b",
      ownerPid: 222,
    });

    const runs = loadSessionRunsFromDisk(
      new Set(),
      "session-a",
      new Set(["wf-referenced"]),
      base,
      9_000,
      () => false,
      999,
    );

    expect(runs.map((run) => run.record.runId).sort()).toEqual([
      "wf-owned",
      "wf-referenced",
    ]);
    const untouched = JSON.parse(
      readFileSync(path.join(unrelatedRunning, "workflow.json"), "utf8"),
    ) as { status: string };
    expect(untouched.status).toBe("running");
  });

  it("skips live foreign owners and only normalizes dead or legacy owners", () => {
    const base = root();
    const liveDir = createRun(base, "wf-live", "running", { ownerPid: 111 });
    createRun(base, "wf-dead", "running", { ownerPid: 222 });
    createRun(base, "wf-same-process", "running", { ownerPid: 999 });
    createRun(base, "wf-legacy", "running");

    const runs = loadRunsFromDisk(
      new Set(),
      base,
      9_000,
      (pid) => pid === 111 || pid === 999,
      999,
    );

    expect(runs.map((run) => run.record.runId).sort()).toEqual([
      "wf-dead",
      "wf-legacy",
      "wf-same-process",
    ]);
    expect(runs.every((run) => run.record.status === "aborted")).toBe(true);
    const live = JSON.parse(
      readFileSync(path.join(liveDir, "workflow.json"), "utf8"),
    ) as { status: string };
    expect(live.status).toBe("running");
  });

  it("rejects running, cross-cwd, and legacy no-cwd resume sources", () => {
    const base = root();
    createRun(base, "wf-running", "running", { ownerPid: 123 });
    expect(() => loadResumeSource("wf-running", base, base)).toThrow(
      /still marked running/,
    );

    createRun(base, "wf-other-cwd", "completed", {
      cwd: path.join(base, "other"),
    });
    expect(() => loadResumeSource("wf-other-cwd", base, base)).toThrow(
      /does not match current cwd/,
    );

    const legacyDir = createRun(base, "wf-no-cwd");
    const legacy = JSON.parse(
      readFileSync(path.join(legacyDir, "workflow.json"), "utf8"),
    ) as Record<string, unknown>;
    delete legacy.cwd;
    writeJson(path.join(legacyDir, "workflow.json"), legacy);
    expect(() => loadResumeSource("wf-no-cwd", base, base)).toThrow(
      /no recorded cwd/,
    );

    createRun(base, "wf-normalized", "completed", {
      cwd: path.join(base, "nested", ".."),
    });
    expect(loadResumeSource("wf-normalized", base, base).record.runId).toBe(
      "wf-normalized",
    );
  });

  it("uses malformed, invalid, and duplicate journal rows as replay barriers", () => {
    const base = root();
    const cases = [
      {
        runId: "wf-malformed",
        journal: `${JSON.stringify(journalRow(1))}\n{\n`,
      },
      {
        runId: "wf-invalid",
        journal:
          `${JSON.stringify(journalRow(1))}\n` +
          `${JSON.stringify({ ...journalRow(1), optsHash: 42 })}\n`,
      },
      {
        runId: "wf-duplicate",
        journal:
          `${JSON.stringify(journalRow(1))}\n` +
          `${JSON.stringify(journalRow(1))}\n`,
      },
    ];

    for (const item of cases) {
      const dir = createRun(base, item.runId);
      writeFileSync(path.join(dir, "journal.jsonl"), item.journal);
      writeJson(path.join(dir, "agents", "1.json"), {
        seq: 1,
        ok: true,
        output: "must not replay",
      });
      expect(loadResumeSource(item.runId, base, base).replayEntries).toEqual([]);
    }
  });

  it("requires exact resultRef for replay and trusted rehydration details", () => {
    const base = root();
    const dir = createRun(base, "wf-untrusted-artifacts");
    writeFileSync(
      path.join(dir, "journal.jsonl"),
      [
        journalRow(1, {
          ok: false,
          error: "journal failure",
          outputHead: "journal one",
        }),
        journalRow(2, {
          resultRef: "agents/../agents/2.json",
          outputHead: "journal two",
        }),
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    writeJson(path.join(dir, "agents", "1.json"), {
      seq: 1,
      ok: true,
      prompt: "untrusted prompt",
      output: "untrusted one",
    });
    writeJson(path.join(dir, "agents", "2.json"), {
      seq: 2,
      ok: true,
      prompt: "untrusted prompt",
      output: "untrusted two",
    });

    const source = loadResumeSource("wf-untrusted-artifacts", base, base);
    expect(source.replayEntries).toEqual([]);

    const wrongRefDir = createRun(base, "wf-wrong-ref");
    writeFileSync(
      path.join(wrongRefDir, "journal.jsonl"),
      `${JSON.stringify(journalRow(1, { resultRef: "./agents/1.json" }))}\n`,
    );
    writeJson(path.join(wrongRefDir, "agents", "1.json"), {
      seq: 1,
      ok: true,
      output: "must not replay",
    });
    expect(loadResumeSource("wf-wrong-ref", base, base).replayEntries).toEqual([]);

    const run = loadRunsFromDisk(new Set(), base).find(
      (candidate) => candidate.record.runId === "wf-untrusted-artifacts",
    )!;
    expect(run.agents[0]).toMatchObject({
      state: "failed",
      error: "journal failure",
      output: "journal one",
    });
    expect(run.agents[0].prompt).toBeUndefined();
    expect(run.agents[1]).toMatchObject({ state: "ok", output: "journal two" });
    expect(run.agents[1].prompt).toBeUndefined();
  });

  it("rejects unknown, invalid, and unreadable resume sources clearly", () => {
    const base = root();
    expect(() => loadResumeSource("wf-missing", base, base)).toThrow(
      /No stored workflow run/,
    );
    expect(() => loadResumeSource("../escape", base, base)).toThrow(
      /Invalid workflow run ID/,
    );

    const dir = createRun(base, "wf-bad");
    rmSync(path.join(dir, "args.json"));
    expect(() => loadResumeSource("wf-bad", base, base)).toThrow(
      /args\.json is unreadable/,
    );
  });
});
