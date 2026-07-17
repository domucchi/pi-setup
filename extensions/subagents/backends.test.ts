import { describe, expect, it } from "vitest";
import { parseAgentFile } from "./src/agents.ts";
import { claudeEffort, interpretClaudeMessage } from "./src/backends/claude.ts";
import {
  codexEffort,
  composeFirstTurn,
  parseTokenUsage,
  toolPreview,
} from "./src/backends/codex.ts";
import { createLineParser, parseJsonRecord } from "./src/backends/jsonl.ts";
import { binaryCandidates } from "./src/backends/resolve.ts";

describe("parseAgentFile backend field", () => {
  it("parses claude/codex and defaults unknown values to pi", () => {
    const claude = parseAgentFile(
      "---\nname: claude\nbackend: claude\n---\nbody",
      "x",
    );
    expect(claude?.backend).toBe("claude");
    expect(parseAgentFile("---\nname: a\nbackend: codex\n---\n", "x")?.backend).toBe(
      "codex",
    );
    expect(parseAgentFile("---\nname: a\n---\n", "x")?.backend).toBe("pi");
    expect(
      parseAgentFile("---\nname: a\nbackend: gemini\n---\n", "x")?.backend,
    ).toBe("pi");
  });
});

describe("interpretClaudeMessage", () => {
  it("captures the model from the init message", () => {
    const meaning = interpretClaudeMessage({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-5",
    });
    expect(meaning.modelLabel).toBe("claude/claude-sonnet-5");
    expect(meaning.settled).toBeUndefined();
  });

  it("maps assistant tool_use blocks to activities and transcript", () => {
    const meaning = interpretClaudeMessage({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at the file." },
          { type: "tool_use", name: "Edit", id: "t1", input: {} },
        ],
      },
    });
    expect(meaning.activities).toEqual(["→ Edit"]);
    expect(meaning.transcript).toEqual(["Looking at the file.", "  → Edit"]);
  });

  it("settles completed on a success result with usage tokens", () => {
    const meaning = interpretClaudeMessage({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "All done.",
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 20,
        output_tokens: 30,
      },
    });
    expect(meaning.settled).toEqual({ kind: "completed", finalText: "All done." });
    expect(meaning.tokens).toBe(160);
  });

  it("settles failed on error results", () => {
    const meaning = interpretClaudeMessage({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "",
    });
    expect(meaning.settled?.kind).toBe("failed");
    expect((meaning.settled as { errorText: string }).errorText).toContain(
      "error_during_execution",
    );
  });
});

describe("claudeEffort", () => {
  it("passes native levels and clamps pi-only ones", () => {
    expect(claudeEffort("high")).toBe("high");
    expect(claudeEffort("max")).toBe("max");
    expect(claudeEffort("off")).toBe("low");
    expect(claudeEffort("minimal")).toBe("low");
    expect(claudeEffort(undefined)).toBeUndefined();
    expect(claudeEffort("weird")).toBeUndefined();
  });
});

describe("codex helpers", () => {
  it("previews v2 items by type", () => {
    expect(
      toolPreview({ id: "i1", type: "commandExecution", command: "npm test\nx" }),
    ).toEqual({ id: "i1", name: "shell", args: "npm test" });
    expect(
      toolPreview({
        id: "i2",
        type: "fileChange",
        changes: [{ path: "a.ts" }, { path: "b.ts" }],
      }),
    ).toEqual({ id: "i2", name: "apply_patch", args: "a.ts, b.ts" });
    expect(toolPreview({ id: "i3", type: "webSearch", query: "docs" })).toEqual({
      id: "i3",
      name: "web_search",
      args: "docs",
    });
    expect(toolPreview({ id: "i4", type: "agentMessage" })).toBeUndefined();
    expect(toolPreview({ type: "commandExecution" })).toBeUndefined();
  });

  it("parses thread token usage", () => {
    expect(
      parseTokenUsage({
        tokenUsage: { last: { totalTokens: 1234 }, modelContextWindow: 272_000 },
      }),
    ).toEqual({ tokens: 1234, contextWindow: 272_000 });
    expect(parseTokenUsage({})).toEqual({
      tokens: undefined,
      contextWindow: undefined,
    });
  });

  it("frames role instructions into the first turn only", () => {
    expect(composeFirstTurn("Be careful.", "Do the task.")).toBe(
      "<role-instructions>\nBe careful.\n</role-instructions>\n\nDo the task.",
    );
    expect(composeFirstTurn(undefined, "Do it.")).toBe("Do it.");
    expect(composeFirstTurn("   ", "Do it.")).toBe("Do it.");
  });

  it("clamps thinking levels to codex efforts", () => {
    expect(codexEffort("high")).toBe("high");
    expect(codexEffort("xhigh")).toBe("high");
    expect(codexEffort("off")).toBe("minimal");
    expect(codexEffort(undefined)).toBeUndefined();
    expect(codexEffort("weird")).toBeUndefined();
  });
});

describe("jsonl", () => {
  it("splits chunks into complete lines", () => {
    const lines: string[] = [];
    const feed = createLineParser((line) => lines.push(line));
    feed('{"a":1}\n{"b"');
    expect(lines).toEqual(['{"a":1}']);
    feed(':2}\n\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("parses records and rejects garbage", () => {
    expect(parseJsonRecord('{"x":1}')).toEqual({ x: 1 });
    expect(parseJsonRecord("[1]")).toBeUndefined();
    expect(parseJsonRecord("nonsense")).toBeUndefined();
  });
});

describe("binaryCandidates", () => {
  it("prefers known locations and filters cmux shims from PATH", () => {
    const candidates = binaryCandidates(
      "codex",
      "/tmp/cmux-cli-shims/abc:/usr/bin",
    );
    expect(candidates.some((c) => c.includes("cmux-cli-shims"))).toBe(false);
    expect(candidates).toContain("/usr/bin/codex");
    expect(candidates[0]).toContain("/.local/bin/codex");
  });
});
