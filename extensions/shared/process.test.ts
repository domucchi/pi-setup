import { describe, expect, it } from "vitest";
import { runCommand } from "./process.ts";

describe("runCommand", () => {
  it("kills the subprocess promptly when the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const promise = runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30000)"],
      process.cwd(),
      30_000,
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain("aborted");
    expect(Date.now() - started).toBeLessThan(5_000); // not the 30s timeout
  });

  it("captures stdout and exit code", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write('hello')"],
      process.cwd(),
      5_000,
    );
    expect(result).toEqual({
      code: 0,
      stdout: "hello",
      stderr: "",
      truncated: false,
    });
  });

  it("stops and marks truncated when stdout exceeds the byte budget", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "setInterval(() => process.stdout.write('x'.repeat(1000)), 1)"],
      process.cwd(),
      5_000,
      { maxStdoutBytes: 5_000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeGreaterThanOrEqual(5_000);
    expect(result.stdout.length).toBeLessThan(1_000_000);
  });

  it("captures stderr and nonzero exit codes", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stderr.write('bad'); process.exit(3)"],
      process.cwd(),
      5_000,
    );
    expect(result.code).toBe(3);
    expect(result.stderr).toBe("bad");
  });

  it("resolves with code 1 when the command does not exist", async () => {
    const result = await runCommand(
      "definitely-not-a-real-command-xyz",
      [],
      process.cwd(),
      5_000,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Failed to run");
  });

  it("kills and resolves with code -1 on timeout", async () => {
    const start = Date.now();
    const result = await runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30_000)"],
      process.cwd(),
      200,
    );
    expect(result.code).toBe(-1);
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
