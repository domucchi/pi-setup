import type { ChildEvent, ChildHandle, RunOutcome } from "./child.ts";

export const MAX_WORKING = 4;
export const MAX_TRACKED = 32;
export const MAX_ACTIVITY = 8;

export type SubagentStatus = "working" | "idle" | "failed" | "cancelled";

export interface SubagentSnapshot {
  id: string;
  title: string;
  agentType: string;
  cwd: string;
  status: SubagentStatus;
  /** Final text of the most recent completed run. */
  finalText: string;
  errorText: string | null;
  lastActivity: string | null;
  /** Recent tool-call previews, newest last (bounded). */
  recentActivity: string[];
  /** Cumulative across runs. */
  toolCalls: number;
  /** The prompt that started the current/most recent run. */
  prompt: string;
  startedAt: number;
  settledAt: number | null;
  runs: number;
  tokens: number | null;
  contextWindow: number | null;
  sessionFile: string | undefined;
  model: string | undefined;
  thinking: string | undefined;
}

interface Entry {
  snapshot: SubagentSnapshot;
  child: ChildHandle | null;
  settleWaiters: (() => void)[];
}

export interface SpawnOptions {
  title: string;
  agentType: string;
  prompt: string;
  cwd: string;
  model?: string;
  thinking?: string;
}

export interface ManagerHooks {
  createChild: (
    options: SpawnOptions & { onEvent: (event: ChildEvent) => void },
  ) => Promise<ChildHandle>;
  /** A run settled and nobody was waiting on it via a tool call. */
  onRunSettled?: (snapshot: SubagentSnapshot, consumed: boolean) => void;
  onWorkingCountChanged?: (count: number) => void;
}

export class SubagentManager {
  private entries = new Map<string, Entry>();
  private counter = 0;
  private reserved = 0;
  private disposed = false;

  constructor(private readonly hooks: ManagerHooks) {}

  workingCount() {
    let count = this.reserved;
    for (const entry of this.entries.values()) {
      if (entry.snapshot.status === "working") count += 1;
    }
    return count;
  }

  /** Detached copy — recentActivity keeps mutating on the live snapshot. */
  private static snap(snapshot: SubagentSnapshot): SubagentSnapshot {
    return { ...snapshot, recentActivity: [...snapshot.recentActivity] };
  }

  list(): SubagentSnapshot[] {
    return [...this.entries.values()].map((entry) =>
      SubagentManager.snap(entry.snapshot),
    );
  }

  get(id: string): SubagentSnapshot | undefined {
    const entry = this.entries.get(id);
    return entry ? SubagentManager.snap(entry.snapshot) : undefined;
  }

  transcriptTail(id: string, lines: number): string[] {
    return this.entries.get(id)?.child?.transcriptTail(lines) ?? [];
  }

  /** Reservation happens synchronously, before the first await. */
  async spawn(options: SpawnOptions): Promise<SubagentSnapshot> {
    if (this.disposed) throw new Error("Subagent manager is shut down.");
    if (this.workingCount() >= MAX_WORKING) {
      throw new Error(
        `Already running ${MAX_WORKING} subagents. Wait for one (subagent_wait) or cancel one before spawning more.`,
      );
    }
    this.reserved += 1;

    try {
      await this.prune();
      this.counter += 1;
      const id = `sub-${this.counter}`;

      const snapshot: SubagentSnapshot = {
        id,
        title: options.title,
        agentType: options.agentType,
        cwd: options.cwd,
        status: "working",
        finalText: "",
        errorText: null,
        lastActivity: null,
        recentActivity: [],
        toolCalls: 0,
        prompt: options.prompt,
        startedAt: Date.now(),
        settledAt: null,
        runs: 1,
        tokens: null,
        contextWindow: null,
        sessionFile: undefined,
        model: options.model,
        thinking: undefined,
      };

      const child = await this.hooks.createChild({
        ...options,
        onEvent: (event) => this.handleChildEvent(id, event),
      });

      const entry: Entry = { snapshot, child, settleWaiters: [] };
      snapshot.sessionFile = child.sessionFile;
      snapshot.model = child.modelLabel ?? options.model;
      snapshot.thinking = child.thinkingLevel;
      this.entries.set(id, entry);
      this.hooks.onWorkingCountChanged?.(this.workingCount() - 1);
      child.prompt(options.prompt);
      return SubagentManager.snap(snapshot);
    } finally {
      this.reserved -= 1;
    }
  }

  /** Steer a working child or start a fresh run on an idle/failed one. */
  async send(id: string, message: string) {
    const entry = this.entries.get(id);
    if (!entry || !entry.child) {
      throw new Error(`No live subagent "${id}". Use subagent_list to see all.`);
    }
    if (entry.snapshot.status === "cancelled") {
      throw new Error(`Subagent "${id}" was cancelled and cannot be resumed.`);
    }
    if (entry.snapshot.status === "working" && entry.child.isStreaming()) {
      await entry.child.steer(message);
      return SubagentManager.snap(entry.snapshot);
    }
    if (this.workingCount() >= MAX_WORKING) {
      throw new Error(
        `Already running ${MAX_WORKING} subagents; cannot start another run on "${id}" right now.`,
      );
    }
    entry.snapshot.status = "working";
    entry.snapshot.errorText = null;
    entry.snapshot.settledAt = null;
    entry.snapshot.runs += 1;
    entry.snapshot.prompt = message;
    this.hooks.onWorkingCountChanged?.(this.workingCount());
    entry.child.prompt(message);
    return SubagentManager.snap(entry.snapshot);
  }

  /** Resolves once every listed subagent is not working. */
  async wait(ids: string[]): Promise<SubagentSnapshot[]> {
    const waits: Promise<void>[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry || entry.snapshot.status !== "working") continue;
      waits.push(
        new Promise((resolve) => {
          entry.settleWaiters.push(resolve);
        }),
      );
    }
    await Promise.all(waits);
    return ids
      .map((id) => this.get(id))
      .filter((s): s is SubagentSnapshot => s !== undefined);
  }

  /** Interrupt and dispose; cancelled children cannot be resumed. */
  async cancel(ids: string[]): Promise<SubagentSnapshot[]> {
    const results: SubagentSnapshot[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const child = entry.child;
      entry.child = null;
      if (entry.snapshot.status === "working") {
        await child?.interrupt();
      }
      await child?.dispose();
      entry.snapshot.status = "cancelled";
      entry.snapshot.settledAt ??= Date.now();
      this.releaseWaiters(entry);
      results.push(SubagentManager.snap(entry.snapshot));
    }
    this.hooks.onWorkingCountChanged?.(this.workingCount());
    return results;
  }

  async disposeAll() {
    this.disposed = true;
    const children = [...this.entries.values()]
      .map((entry) => {
        const child = entry.child;
        entry.child = null;
        return child;
      })
      .filter((c): c is ChildHandle => c !== null);
    this.entries.clear();
    await Promise.all(children.map((child) => child.dispose().catch(() => {})));
  }

  private handleChildEvent(id: string, event: ChildEvent) {
    const entry = this.entries.get(id);
    if (!entry) return;
    switch (event.type) {
      case "run-started":
        break;
      case "activity": {
        entry.snapshot.lastActivity = event.preview;
        entry.snapshot.recentActivity.push(event.preview);
        if (entry.snapshot.recentActivity.length > MAX_ACTIVITY) {
          entry.snapshot.recentActivity.shift();
        }
        if (event.preview.startsWith("→")) entry.snapshot.toolCalls += 1;
        // Keep the token gauge live while the child works.
        const usage = entry.child?.usage();
        if (usage?.tokens !== undefined) entry.snapshot.tokens = usage.tokens;
        if (usage?.contextWindow !== undefined) {
          entry.snapshot.contextWindow = usage.contextWindow;
        }
        break;
      }
      case "run-settled":
        this.settleRun(entry, event.outcome);
        break;
    }
  }

  private settleRun(entry: Entry, outcome: RunOutcome) {
    if (entry.snapshot.status !== "working") return;
    entry.snapshot.settledAt = Date.now();
    if (outcome.kind === "completed") {
      entry.snapshot.status = "idle";
      entry.snapshot.finalText = outcome.finalText;
      entry.snapshot.errorText = null;
    } else if (outcome.kind === "failed") {
      entry.snapshot.status = "failed";
      entry.snapshot.errorText = outcome.errorText;
      if (outcome.partialText) entry.snapshot.finalText = outcome.partialText;
    } else {
      entry.snapshot.status = "idle";
      entry.snapshot.errorText = "interrupted";
      if (outcome.partialText) entry.snapshot.finalText = outcome.partialText;
    }
    const usage = entry.child?.usage();
    entry.snapshot.tokens = usage?.tokens ?? entry.snapshot.tokens;
    entry.snapshot.contextWindow =
      usage?.contextWindow ?? entry.snapshot.contextWindow;

    const consumed = entry.settleWaiters.length > 0;
    this.releaseWaiters(entry);
    this.hooks.onWorkingCountChanged?.(this.workingCount());
    this.hooks.onRunSettled?.(SubagentManager.snap(entry.snapshot), consumed);
  }

  private releaseWaiters(entry: Entry) {
    const waiters = entry.settleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  /** LRU-dispose settled children beyond the tracking cap. */
  private async prune() {
    if (this.entries.size < MAX_TRACKED) return;
    const settled = [...this.entries.entries()]
      .filter(([, entry]) => entry.snapshot.status !== "working")
      .sort(
        ([, a], [, b]) =>
          (a.snapshot.settledAt ?? 0) - (b.snapshot.settledAt ?? 0),
      );
    for (const [id, entry] of settled) {
      if (this.entries.size < MAX_TRACKED) break;
      const child = entry.child;
      entry.child = null;
      this.entries.delete(id);
      await child?.dispose().catch(() => {});
    }
  }
}
