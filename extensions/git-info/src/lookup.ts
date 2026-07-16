import type { CommandResult } from "../../shared/process.ts";
import type { ForgeConfig } from "./config.ts";
import { detectForge, forgeLookupCommand, type Forge } from "./forge.ts";
import {
  parseGitHubPrJson,
  parseGitLabMrJson,
  type PullRequestInfo,
} from "./state.ts";

const PARSERS: Record<Forge, (json: string) => PullRequestInfo | null> = {
  github: parseGitHubPrJson,
  gitlab: parseGitLabMrJson,
};

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

/**
 * Look up the open PR/MR for a branch. Picks gh or glab from the origin
 * remote URL; when the forge can't be told from the URL (self-hosted on
 * a custom domain), tries each installed CLI until one answers. A missing
 * CLI is skipped; a known forge returning nothing is definitive.
 */
export async function lookupChange(
  branch: string,
  run: CommandRunner,
  config?: ForgeConfig,
): Promise<PullRequestInfo | null> {
  const remote = await run("git", ["remote", "get-url", "origin"]);
  const forge =
    remote.code === 0 ? detectForge(remote.stdout.trim(), config) : null;
  const candidates: Forge[] = forge ? [forge] : ["github", "gitlab"];

  for (const candidate of candidates) {
    const { command, args } = forgeLookupCommand(candidate, branch);
    const result = await run(command, args);
    if (result.stderr.includes("Failed to run")) continue; // CLI not installed
    if (result.code !== 0) {
      // Installed but no open change — definitive when the forge is known;
      // otherwise this may be the wrong CLI, so try the next candidate.
      if (forge) return null;
      continue;
    }
    const parsed = PARSERS[candidate](result.stdout);
    if (parsed || forge) return parsed;
  }
  return null;
}
