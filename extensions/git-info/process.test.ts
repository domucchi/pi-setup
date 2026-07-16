import { describe, expect, it } from "vitest";
import { runCommand } from "./src/process.ts";

describe("runCommand", () => {
  it("captures stdout and exit code", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write('hello')"],
      process.cwd(),
      5_000,
    );
    expect(result).toEqual({ code: 0, stdout: "hello", stderr: "" });
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
