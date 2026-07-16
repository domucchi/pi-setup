import type { ForgeConfig } from "./config.ts";

export type Forge = "github" | "gitlab";

/**
 * Guess the forge from a git remote URL. Configured self-hosted hosts win
 * first (so git.example.com can be declared as GitLab), then github.com /
 * gitlab.com and hosts whose domain contains the name. Returns null when
 * nothing matches, in which case the caller falls back to trying each
 * installed CLI.
 */
export function detectForge(
  remoteUrl: string,
  config?: ForgeConfig,
): Forge | null {
  const lower = remoteUrl.toLowerCase();
  if (config) {
    if (config.gitlabHosts.some((host) => lower.includes(host))) return "gitlab";
    if (config.githubHosts.some((host) => lower.includes(host))) return "github";
  }
  if (lower.includes("gitlab")) return "gitlab";
  if (lower.includes("github")) return "github";
  return null;
}

/** CLI + args to view the open change for a branch, emitting JSON. */
export function forgeLookupCommand(
  forge: Forge,
  branch: string,
): { command: string; args: string[] } {
  if (forge === "gitlab") {
    return {
      command: "glab",
      args: ["mr", "view", branch, "--output", "json"],
    };
  }
  return {
    command: "gh",
    args: ["pr", "view", branch, "--json", "number,url,state,isDraft"],
  };
}
