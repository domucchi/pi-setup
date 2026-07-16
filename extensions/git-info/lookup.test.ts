import { describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../shared/process.ts";
import { lookupChange } from "./src/lookup.ts";

const ok = (stdout: string): CommandResult => ({
  code: 0,
  stdout,
  stderr: "",
  truncated: false,
});
const fail = (stderr = ""): CommandResult => ({
  code: 1,
  stdout: "",
  stderr,
  truncated: false,
});

const GH_MR = JSON.stringify({
  number: 5,
  url: "https://github.com/x/y/pull/5",
  state: "OPEN",
  isDraft: false,
});
const GL_MR = JSON.stringify({
  iid: 9,
  web_url: "https://gitlab.com/g/p/-/merge_requests/9",
  state: "opened",
  draft: true,
});

function runner(map: Record<string, CommandResult>) {
  return vi.fn(async (command: string) =>
    command === "git"
      ? (map.git ?? fail())
      : command === "gh"
        ? (map.gh ?? fail())
        : (map.glab ?? fail()),
  );
}

describe("lookupChange", () => {
  it("uses gh for a github remote", async () => {
    const run = runner({
      git: ok("git@github.com:x/y.git"),
      gh: ok(GH_MR),
    });
    const result = await lookupChange("feat", run);
    expect(result?.kind).toBe("pr");
    expect(result?.number).toBe(5);
    // Never falls through to glab once the forge is known.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("uses glab for a gitlab remote", async () => {
    const run = runner({
      git: ok("git@gitlab.com:g/p.git"),
      glab: ok(GL_MR),
    });
    const result = await lookupChange("feat", run);
    expect(result?.kind).toBe("mr");
    expect(result?.number).toBe(9);
    expect(result?.isDraft).toBe(true);
  });

  it("returns null definitively when a known forge has no open change", async () => {
    const run = runner({ git: ok("git@github.com:x/y.git"), gh: fail() });
    expect(await lookupChange("feat", run)).toBeNull();
    // gh only — must not also try glab for a known github remote.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("falls back across CLIs for an unrecognizable remote", async () => {
    const run = runner({
      git: ok("git@git.internal.io:g/p.git"),
      gh: fail(), // installed, no PR (not this forge)
      glab: ok(GL_MR),
    });
    const result = await lookupChange("feat", run);
    expect(result?.kind).toBe("mr");
    expect(run).toHaveBeenCalledTimes(3); // git, gh, glab
  });

  it("skips a missing CLI and tries the next", async () => {
    const run = runner({
      git: ok("git@git.internal.io:g/p.git"),
      gh: fail("Failed to run gh: ENOENT"),
      glab: ok(GL_MR),
    });
    expect((await lookupChange("feat", run))?.kind).toBe("mr");
  });

  it("returns null when there is no origin remote", async () => {
    const run = runner({ git: fail() });
    expect(await lookupChange("feat", run)).toBeNull();
    expect(run).toHaveBeenCalledTimes(3); // git, then both CLIs (unknown forge)
  });

  it("falls back to glab for an unrecognized self-hosted host", async () => {
    const run = runner({
      git: ok("git@git.example.com:team/app.git"),
      gh: fail(), // installed, not this forge
      glab: ok(GL_MR),
    });
    const result = await lookupChange("feat", run);
    expect(result?.kind).toBe("mr");
    expect(run).toHaveBeenCalledTimes(3); // git, gh probe, then glab
  });
});
