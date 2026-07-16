import { describe, expect, it } from "vitest";
import { buildPsDetailLines, buildPsLabel, describeDuration } from "./prompt.ts";
import { OutputBuffer } from "./src/output.ts";
import type { TerminalEntry } from "./src/manager.ts";

function entry(overrides: Partial<TerminalEntry> = {}): TerminalEntry {
  const stdout = new OutputBuffer();
  const stderr = new OutputBuffer();
  return {
    id: "bg-1",
    title: "dev server",
    command: "npm run dev",
    cwd: "/tmp/proj",
    status: "running",
    exitCode: null,
    signal: null,
    startedAt: Date.now() - 5_000,
    settledAt: null,
    stdout,
    stderr,
    spill: null,
    ...overrides,
  };
}

describe("describeDuration", () => {
  it("shows ms, seconds, and minutes with seconds", () => {
    const t = 1_000_000;
    expect(describeDuration(t, t + 500)).toBe("500ms");
    expect(describeDuration(t, t + 42_000)).toBe("42s");
    expect(describeDuration(t, t + 83_000)).toBe("1min 23s");
    expect(describeDuration(t, t + 120_000)).toBe("2min");
  });
});

describe("buildPsLabel", () => {
  it("shows id, state, title, and the command", () => {
    const label = buildPsLabel(entry());
    expect(label).toContain("bg-1");
    expect(label).toContain("running");
    expect(label).toContain("dev server");
    expect(label).toContain("$ npm run dev");
  });

  it("flattens and truncates long commands", () => {
    const label = buildPsLabel(
      entry({ command: `npm run dev --\n  ${"x".repeat(100)}` }),
    );
    expect(label).not.toContain("\n");
    expect(label).toContain("…");
  });
});

describe("buildPsDetailLines", () => {
  it("includes command, cwd, and output tails", () => {
    const e = entry();
    e.stdout.append("line1\nline2\n");
    e.stderr.append("oops\n");
    const lines = buildPsDetailLines(e);
    expect(lines[1]).toBe("$ npm run dev");
    expect(lines[2]).toBe("cwd: /tmp/proj");
    expect(lines).toContain("  line2");
    expect(lines).toContain("  oops");
  });

  it("marks empty stdout and omits empty stderr", () => {
    const lines = buildPsDetailLines(entry());
    expect(lines).toContain("  (empty)");
    expect(lines.join("\n")).not.toContain("stderr");
  });
});
