import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentDefinitions, parseAgentFile } from "./src/agents.ts";

describe("parseAgentFile", () => {
  it("parses frontmatter, tools list, and body", () => {
    const parsed = parseAgentFile(
      "---\nname: explore\ndescription: scout\ntools: read, grep , fd\nthinking: low\n---\nBe read-only.",
      "x.md",
    );
    expect(parsed).toMatchObject({
      name: "explore",
      description: "scout",
      tools: ["read", "grep", "fd"],
      thinking: "low",
      systemPrompt: "Be read-only.",
    });
  });

  it("returns null without frontmatter or name", () => {
    expect(parseAgentFile("just text", "x.md")).toBeNull();
    expect(parseAgentFile("---\ndescription: no name\n---\n", "x.md")).toBeNull();
  });

  it("treats an empty tools list as unrestricted", () => {
    const parsed = parseAgentFile("---\nname: a\ntools:\n---\n", "x.md");
    expect(parsed?.tools).toBeUndefined();
  });
});

describe("loadAgentDefinitions", () => {
  it("always includes the built-in worker and lets files override it", () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "agents-"));
    const definitions = loadAgentDefinitions({
      agentDir,
      cwd: agentDir,
      projectTrusted: false,
    });
    expect(definitions.get("worker")?.source).toBe("built-in");
  });

  it("project agents override global ones only when trusted", () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "agents-global-"));
    const cwd = mkdtempSync(path.join(tmpdir(), "agents-proj-"));
    mkdirSync(path.join(agentDir, "agents"), { recursive: true });
    mkdirSync(path.join(cwd, ".pi", "agents"), { recursive: true });
    writeFileSync(
      path.join(agentDir, "agents", "scout.md"),
      "---\nname: scout\ndescription: global\n---\n",
    );
    writeFileSync(
      path.join(cwd, ".pi", "agents", "scout.md"),
      "---\nname: scout\ndescription: project\n---\n",
    );

    const untrusted = loadAgentDefinitions({ agentDir, cwd, projectTrusted: false });
    expect(untrusted.get("scout")?.description).toBe("global");

    const trusted = loadAgentDefinitions({ agentDir, cwd, projectTrusted: true });
    expect(trusted.get("scout")?.description).toBe("project");
  });

  it("skips broken role files instead of throwing", () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "agents-broken-"));
    mkdirSync(path.join(agentDir, "agents"), { recursive: true });
    writeFileSync(path.join(agentDir, "agents", "bad.md"), "no frontmatter");
    const definitions = loadAgentDefinitions({
      agentDir,
      cwd: agentDir,
      projectTrusted: false,
    });
    expect(definitions.has("bad")).toBe(false);
    expect(definitions.has("worker")).toBe(true);
  });
});
