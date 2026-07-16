import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const saved = process.env.WEB_TEST_KEY;
afterEach(() => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.WEB_TEST_KEY;
  else process.env.WEB_TEST_KEY = saved;
});

async function withAgentDir(dir: string) {
  vi.resetModules();
  vi.doMock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => dir }));
  return (await import("./env.ts")).readEnvValue;
}

describe("readEnvValue", () => {
  it("prefers process.env over the .env file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "env-"));
    writeFileSync(path.join(dir, ".env"), "WEB_TEST_KEY=from-file");
    process.env.WEB_TEST_KEY = "from-env";
    const readEnvValue = await withAgentDir(dir);
    expect(readEnvValue("WEB_TEST_KEY")).toBe("from-env");
  });

  it("reads from <agentDir>/.env, handling quotes and export", async () => {
    delete process.env.WEB_TEST_KEY;
    const dir = mkdtempSync(path.join(tmpdir(), "env-"));
    writeFileSync(
      path.join(dir, ".env"),
      "# comment\nexport WEB_TEST_KEY = \"secret-123\"\nOTHER=x",
    );
    const readEnvValue = await withAgentDir(dir);
    expect(readEnvValue("WEB_TEST_KEY")).toBe("secret-123");
  });

  it("returns undefined when unset and no file exists", async () => {
    delete process.env.WEB_TEST_KEY;
    const dir = mkdtempSync(path.join(tmpdir(), "env-"));
    const readEnvValue = await withAgentDir(dir);
    expect(readEnvValue("WEB_TEST_KEY")).toBeUndefined();
  });
});
