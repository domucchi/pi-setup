import { describe, expect, it } from "vitest";
import { detectForge, forgeLookupCommand } from "./src/forge.ts";

describe("detectForge", () => {
  it("recognizes github and gitlab across URL forms", () => {
    expect(detectForge("https://github.com/u/r.git")).toBe("github");
    expect(detectForge("git@github.com:u/r.git")).toBe("github");
    expect(detectForge("https://gitlab.com/g/p.git")).toBe("gitlab");
    expect(detectForge("git@gitlab.example.com:g/p.git")).toBe("gitlab");
  });

  it("returns null for unrecognizable hosts", () => {
    expect(detectForge("git@git.mycompany.io:g/p.git")).toBeNull();
    expect(detectForge("")).toBeNull();
  });
});

describe("forgeLookupCommand", () => {
  it("uses gh for github and glab for gitlab, emitting JSON", () => {
    const gh = forgeLookupCommand("github", "feat/x");
    expect(gh.command).toBe("gh");
    expect(gh.args).toContain("feat/x");
    expect(gh.args).toContain("--json");

    const gl = forgeLookupCommand("gitlab", "feat/x");
    expect(gl.command).toBe("glab");
    expect(gl.args).toEqual(["mr", "view", "feat/x", "--output", "json"]);
  });
});
