import { describe, expect, it } from "vitest";
import {
  composeWorkingMessage,
  phaseLabel,
  toolActivityLabel,
} from "./src/activity.ts";

describe("toolActivityLabel", () => {
  it("picks the most informative arg per tool", () => {
    expect(toolActivityLabel("bash", { command: "npm test\n--flag" })).toBe(
      "bash npm test",
    );
    expect(toolActivityLabel("edit", { path: "src/manager.ts" })).toBe(
      "edit src/manager.ts",
    );
    expect(toolActivityLabel("rg", { pattern: "watchdog", limit: 5 })).toBe(
      "rg watchdog",
    );
    expect(toolActivityLabel("browser_goto", { url: "http://localhost:5173" })).toBe(
      "browser_goto http://localhost:5173",
    );
  });

  it("falls back to the bare tool name and clips long labels", () => {
    expect(toolActivityLabel("subagent_list", {})).toBe("subagent_list");
    expect(toolActivityLabel("bash", undefined)).toBe("bash");
    const long = toolActivityLabel("bash", { command: "x".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(56);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("phaseLabel", () => {
  it("maps streaming event types to phases", () => {
    expect(phaseLabel("thinking_delta")).toBe("thinking…");
    expect(phaseLabel("thinking_start")).toBe("thinking…");
    expect(phaseLabel("text_delta")).toBe("writing…");
    expect(phaseLabel("toolcall_delta")).toBeUndefined();
    expect(phaseLabel("done")).toBeUndefined();
  });
});

describe("composeWorkingMessage", () => {
  it("joins activity, elapsed, tokens, and the interrupt hint", () => {
    expect(
      composeWorkingMessage({
        activity: "edit manager.ts",
        elapsedMs: 106_000,
        outputTokens: 14_500,
      }),
    ).toBe("edit manager.ts · 1m46s · ↓ 14.5k tok · esc to interrupt");
  });

  it("omits tokens at zero and falls back to Working...", () => {
    expect(composeWorkingMessage({ elapsedMs: 5_000, outputTokens: 0 })).toBe(
      "Working... · 5s · esc to interrupt",
    );
  });
});
