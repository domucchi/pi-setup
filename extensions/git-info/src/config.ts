import { readFileSync } from "node:fs";
import * as path from "node:path";

export interface ForgeConfig {
  githubHosts: string[];
  gitlabHosts: string[];
}

const EMPTY: ForgeConfig = { githubHosts: [], gitlabHosts: [] };

function splitEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function readFileHosts(agentDir: string, key: string): string[] {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(agentDir, "git-info.json"), "utf8"),
    ) as Record<string, unknown>;
    const list = raw[key];
    return Array.isArray(list)
      ? list.filter((h): h is string => typeof h === "string").map((h) => h.toLowerCase())
      : [];
  } catch {
    return [];
  }
}

/**
 * Self-hosted forge hosts, so a remote whose domain doesn't contain
 * "github"/"gitlab" still routes to the right CLI. Sourced from
 * PI_GITHUB_HOSTS / PI_GITLAB_HOSTS (comma-separated) and merged with
 * `<agentDir>/git-info.json` ({ "gitlabHosts": ["git.example.com"] }).
 * Any read error yields empty lists — detection just falls back.
 */
export function loadForgeConfig(agentDir: string): ForgeConfig {
  try {
    return {
      githubHosts: [
        ...splitEnv(process.env.PI_GITHUB_HOSTS),
        ...readFileHosts(agentDir, "githubHosts"),
      ],
      gitlabHosts: [
        ...splitEnv(process.env.PI_GITLAB_HOSTS),
        ...readFileHosts(agentDir, "gitlabHosts"),
      ],
    };
  } catch {
    return EMPTY;
  }
}
