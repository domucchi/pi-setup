export type Forge = "github" | "gitlab";

/**
 * Guess the forge from a git remote URL: github.com / gitlab.com and
 * self-hosted hosts whose domain contains the name. Returns null when
 * neither is recognizable (e.g. a self-hosted GitLab on a custom domain),
 * in which case the caller falls back to trying each installed CLI.
 */
export function detectForge(remoteUrl: string): Forge | null {
  const lower = remoteUrl.toLowerCase();
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
