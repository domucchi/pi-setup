import { spawn, type ChildProcess } from "node:child_process";
import { OutputBuffer } from "./output.ts";
import { createSpillTarget, type SpillTarget } from "./spill.ts";

export const MAX_RUNNING = 8;
export const MAX_TRACKED = 32;
const KILL_ESCALATION_MS = 2_000;

export type TerminalStatus = "running" | "done" | "failed" | "killed";

export interface TerminalEntry {
  id: string;
  title: string;
  command: string;
  cwd: string;
  status: TerminalStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: number;
  settledAt: number | null;
  stdout: OutputBuffer;
  stderr: OutputBuffer;
  spill: SpillTarget | null;
}

interface InternalEntry extends TerminalEntry {
  child: ChildProcess;
  killSignaled: boolean;
  /** Recorded on "exit"; the entry only settles on "close" (flushed pipes). */
  recordedExit: { code: number | null; signal: NodeJS.Signals | null } | null;
  escalationTimer: ReturnType<typeof setTimeout> | undefined;
  settleWaiters: (() => void)[];
}

export interface TerminalManagerHooks {
  onSettled?: (entry: TerminalEntry) => void;
  onRunningCountChanged?: (count: number) => void;
  /** Injectable for tests; defaults to real spill files. */
  createSpill?: (id: string) => SpillTarget | null;
}

export class TerminalManager {
  private entries = new Map<string, InternalEntry>();
  private counter = 0;
  private disposed = false;

  constructor(private readonly hooks: TerminalManagerHooks = {}) {}

  runningCount() {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "running") count += 1;
    }
    return count;
  }

  list(): TerminalEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): TerminalEntry | undefined {
    return this.entries.get(id);
  }

  start(options: { command: string; title: string; cwd: string }) {
    if (this.disposed) throw new Error("Terminal manager is shut down.");
    if (this.runningCount() >= MAX_RUNNING) {
      throw new Error(
        `Already running ${MAX_RUNNING} background terminals. Kill one with bg_kill before starting another.`,
      );
    }
    this.prune();

    this.counter += 1;
    const id = `bg-${this.counter}`;
    const spill = this.hooks.createSpill
      ? this.hooks.createSpill(id)
      : createSpillTarget(id);

    // detached: own process group, so kill(-pid) takes down descendants.
    const child = spawn("/bin/sh", ["-c", options.command], {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const entry: InternalEntry = {
      id,
      title: options.title,
      command: options.command,
      cwd: options.cwd,
      status: "running",
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      settledAt: null,
      stdout: new OutputBuffer(),
      stderr: new OutputBuffer(),
      spill,
      child,
      killSignaled: false,
      recordedExit: null,
      escalationTimer: undefined,
      settleWaiters: [],
    };
    this.entries.set(id, entry);
    this.hooks.onRunningCountChanged?.(this.runningCount());

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      entry.stdout.append(chunk);
      spill?.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      entry.stderr.append(chunk);
      spill?.stderr.write(chunk);
    });

    child.on("error", () => {
      // Spawn failure: no "exit" will follow reliably; settle as failed.
      entry.recordedExit ??= { code: null, signal: null };
      this.settle(entry);
    });
    child.on("exit", (code, signal) => {
      entry.recordedExit = { code, signal };
    });
    child.on("close", () => {
      this.settle(entry);
    });

    return this.snapshot(entry);
  }

  /** Resolves once every id has settled (unknown ids resolve immediately). */
  async kill(ids: string[]) {
    const waits: Promise<void>[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry || entry.status !== "running") continue;
      this.signalTree(entry, "SIGTERM");
      entry.killSignaled = true;
      entry.escalationTimer = setTimeout(() => {
        if (entry.status === "running") this.signalTree(entry, "SIGKILL");
      }, KILL_ESCALATION_MS);
      entry.escalationTimer.unref?.();
      waits.push(
        new Promise((resolve) => {
          entry.settleWaiters.push(resolve);
        }),
      );
    }
    await Promise.all(waits);
    return ids.map((id) => this.get(id)).filter((e) => e !== undefined);
  }

  /** SIGKILL everything and drop all entries. Spill files are left on disk. */
  disposeAll() {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.status === "running") {
        entry.killSignaled = true;
        this.signalTree(entry, "SIGKILL");
      }
    }
  }

  private signalTree(entry: InternalEntry, signal: NodeJS.Signals) {
    const pid = entry.child.pid;
    try {
      if (pid) process.kill(-pid, signal);
      else entry.child.kill(signal);
    } catch {
      try {
        entry.child.kill(signal);
      } catch {
        // Already gone; "close" will settle it.
      }
    }
  }

  private settle(entry: InternalEntry) {
    if (entry.status !== "running") return;
    const exit = entry.recordedExit ?? { code: null, signal: null };
    entry.exitCode = exit.code;
    entry.signal = exit.signal;
    entry.status = entry.killSignaled
      ? "killed"
      : exit.code === 0
        ? "done"
        : "failed";
    entry.settledAt = Date.now();
    if (entry.escalationTimer) clearTimeout(entry.escalationTimer);
    entry.spill?.stdout.end();
    entry.spill?.stderr.end();

    const waiters = entry.settleWaiters.splice(0);
    for (const resolve of waiters) resolve();
    this.hooks.onRunningCountChanged?.(this.runningCount());
    this.hooks.onSettled?.(this.snapshot(entry));
  }

  /** Keep the registry bounded: drop the oldest settled entries. */
  private prune() {
    if (this.entries.size < MAX_TRACKED) return;
    const settled = [...this.entries.values()]
      .filter((e) => e.status !== "running")
      .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
    for (const entry of settled) {
      if (this.entries.size < MAX_TRACKED) break;
      this.entries.delete(entry.id);
    }
  }

  private snapshot(entry: InternalEntry): TerminalEntry {
    const { child, killSignaled, recordedExit, escalationTimer, settleWaiters, ...pub } =
      entry;
    return { ...pub };
  }
}
