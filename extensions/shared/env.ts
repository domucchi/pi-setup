import { readFileSync } from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

function parseEnvValue(text: string, name: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match || match[1] !== name) continue;
    const value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

/**
 * Read a secret/config value: real process env first, then
 * `<agentDir>/.env` (KEY=value, optional quotes and `export`). Keeps
 * secrets out of the repo and out of the global shell — the .env lives
 * in ~/.pi/agent, which is never version-controlled. Returns undefined
 * when unset or the file is unreadable.
 */
export function readEnvValue(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  try {
    return parseEnvValue(
      readFileSync(path.join(getAgentDir(), ".env"), "utf8"),
      name,
    );
  } catch {
    return undefined;
  }
}
