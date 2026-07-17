import { describe, expect, it } from "vitest";
import { DESCRIPTION, PROMPT_GUIDELINES } from "./prompt.ts";

describe("tool loader prompt", () => {
  it("advertises every deferred capability and preserves its routing policy", () => {
    const text = [DESCRIPTION, ...PROMPT_GUIDELINES].join("\n");
    for (const capability of [
      "browser",
      "terminals",
      "subagents",
      "workflows",
      "web",
    ]) {
      expect(text).toContain(capability);
    }
    expect(text).toContain("explicitly requests");
    expect(text).toContain("long-running");
  });
});
