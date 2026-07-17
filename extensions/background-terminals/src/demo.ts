/**
 * Fixture data for `/ps demo` — preview the dashboard UI without running
 * real processes. Timestamps are relative to `now`, so the running
 * terminal's duration ticks live; x (kill) mutates the fixtures.
 */

import type { TerminalsHost } from "../dashboard.ts";
import { OutputBuffer } from "./output.ts";
import type { SpillTarget } from "./spill.ts";
import type { TerminalEntry } from "./manager.ts";

function buffer(text: string): OutputBuffer {
  const out = new OutputBuffer();
  if (text) out.append(text);
  return out;
}

/** Paths-only spill stub — the dashboard reads paths, never the writers. */
function fakeSpill(id: string): SpillTarget {
  const dir = "/tmp/pi-bg-terminals/demo";
  return {
    dir,
    stdoutPath: `${dir}/${id}-stdout.log`,
    stderrPath: `${dir}/${id}-stderr.log`,
    stdout: null,
    stderr: null,
  } as unknown as SpillTarget;
}

const DEV_SERVER_STDOUT = [
  "> pi-setup@1.0.0 dev",
  "> vite dev --port 5173",
  "",
  "  VITE v6.0.3  ready in 412 ms",
  "",
  "  ➜  Local:   http://localhost:5173/",
  "  ➜  Network: http://192.168.1.12:5173/",
  "",
  "12:01:03 [vite] hmr update /src/App.tsx",
  "12:01:11 [vite] hmr update /src/components/Dashboard.tsx",
  "12:01:40 [vite] page reload src/router.ts",
  "12:02:05 [vite] hmr update /src/App.tsx (x2)",
].join("\n");

const TEST_STDOUT = [
  " RUN  v4.1.10 /Users/you/code/pi-setup",
  "",
  " ✓ extensions/shared/agent-format.test.ts (12 tests)",
  " ✗ extensions/workflows/view.test.ts (19 tests | 1 failed)",
  "   → groupAgentsByPhase > collects unphased agents",
].join("\n");

const TEST_STDERR = [
  "AssertionError: expected [ 'Find' ] to deeply equal [ 'Find', 'unphased' ]",
  "    at view.test.ts:52:38",
].join("\n");

export function createDemoTerminals(now: number): TerminalEntry[] {
  return [
    {
      id: "bg-1",
      title: "dev server",
      command: "npm run dev",
      cwd: "/Users/you/code/pi-setup",
      status: "running",
      exitCode: null,
      signal: null,
      startedAt: now - 3 * 60_000,
      settledAt: null,
      stdout: buffer(DEV_SERVER_STDOUT),
      stderr: buffer(""),
      spill: fakeSpill("bg-1"),
    },
    {
      id: "bg-2",
      title: "typecheck",
      command: "npx tsc --noEmit",
      cwd: "/Users/you/code/pi-setup",
      status: "done",
      exitCode: 0,
      signal: null,
      startedAt: now - 5 * 60_000,
      settledAt: now - 5 * 60_000 + 41_000,
      stdout: buffer(""),
      stderr: buffer(""),
      spill: null,
    },
    {
      id: "bg-3",
      title: "unit tests",
      command: "npx vitest run --reporter=verbose",
      cwd: "/Users/you/code/pi-setup",
      status: "failed",
      exitCode: 1,
      signal: null,
      startedAt: now - 9 * 60_000,
      settledAt: now - 8 * 60_000,
      stdout: buffer(TEST_STDOUT),
      stderr: buffer(TEST_STDERR),
      spill: fakeSpill("bg-3"),
    },
    {
      id: "bg-4",
      title: "stale file watcher",
      command: "fswatch -r src | xargs -n1 echo",
      cwd: "/Users/you/code/pi-setup",
      status: "killed",
      exitCode: null,
      signal: "SIGTERM",
      startedAt: now - 25 * 60_000,
      settledAt: now - 20 * 60_000,
      stdout: buffer("src/App.tsx\nsrc/router.ts\n"),
      stderr: buffer(""),
      spill: null,
    },
  ];
}

/** Host over mutable fixtures — x (kill) behaves like the real thing. */
export function demoTerminalsHost(entries: TerminalEntry[]): TerminalsHost {
  return {
    list: () => entries,
    kill: (id) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry || entry.status !== "running") return;
      entry.status = "killed";
      entry.signal = "SIGTERM";
      entry.settledAt = Date.now();
    },
  };
}
