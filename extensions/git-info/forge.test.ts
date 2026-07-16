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

  it("routes configured self-hosted hosts, ahead of the built-in match", () => {
    const config = {
      gitlabHosts: ["git.example.com"],
      githubHosts: ["ghe.corp"],
    };
    expect(detectForge("git@git.example.com:team/app.git", config)).toBe(
      "gitlab",
    );
    expect(detectForge("https://ghe.corp/team/app.git", config)).toBe("github");
    // A configured gitlab host wins even if "github" appears elsewhere.
    expect(
      detectForge("git@git.example.com:github-mirror/app.git", config),
    ).toBe("gitlab");
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
