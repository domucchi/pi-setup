import { describe, expect, it } from "vitest";
import {
  initialTools,
  isDeferredTool,
  toolsForCapabilities,
} from "./src/groups.ts";

describe("deferred capability groups", () => {
  it("recognizes every deferred tool family without hiding core tools", () => {
    expect([
      "browser_goto",
      "bg_start",
      "subagent_spawn",
      "workflow",
      "workflow_status",
      "web_search",
    ].every(isDeferredTool)).toBe(true);
    expect(isDeferredTool("read")).toBe(false);
    expect(isDeferredTool("mcp")).toBe(false);
  });

  it("builds the initial tool set and restores deferred tools recorded in the branch", () => {
    expect(
      initialTools(
        ["read", "browser_goto", "bg_start", "workflow", "mcp"],
        "load_tools",
        ["browser_goto", "browser_close", "read"],
      ),
    ).toEqual(["read", "mcp", "browser_goto", "browser_close", "load_tools"]);
  });

  it("loads complete selected groups in registration order", () => {
    const all = [
      "read",
      "browser_goto",
      "browser_close",
      "bg_start",
      "bg_status",
      "web_search",
    ];
    expect(toolsForCapabilities(all, ["browser", "terminals"])).toEqual([
      "browser_goto",
      "browser_close",
      "bg_start",
      "bg_status",
    ]);
  });
});
