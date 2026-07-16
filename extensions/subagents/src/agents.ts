import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

/** A subagent role parsed from agents/*.md (Claude Code style). */
export interface AgentDefinition {
  name: string;
  description: string;
  /** Tool allowlist; undefined = all tools (minus the child denylist). */
  tools?: string[];
  model?: string;
  thinking?: string;
  /** Markdown body, appended to the child's system prompt. */
  systemPrompt?: string;
  source: string;
}

/** Built-in default role: full toolset, no extra prompt. */
export const WORKER: AgentDefinition = {
  name: "worker",
  description: "General-purpose subagent with the full toolset.",
  source: "built-in",
};

/**
 * Parse a `--- key: value --- body` agent file. Returns null when there
 * is no frontmatter or no name — a broken role file must never take
 * down extension loading, so callers skip nulls.
 */
export function parseAgentFile(
  content: string,
  source: string,
): AgentDefinition | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const name = fields.get("name");
  if (!name) return null;

  const tools = fields
    .get("tools")
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const body = match[2].trim();

  return {
    name,
    description: fields.get("description") ?? "",
    tools: tools && tools.length > 0 ? tools : undefined,
    model: fields.get("model") || undefined,
    thinking: fields.get("thinking") || undefined,
    systemPrompt: body || undefined,
    source,
  };
}

function loadDir(dir: string, definitions: Map<string, AgentDefinition>) {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return;
  }
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const parsed = parseAgentFile(readFileSync(full, "utf8"), full);
      if (parsed) definitions.set(parsed.name, parsed);
    } catch {
      // Unreadable role file: skip, never throw.
    }
  }
}

/**
 * Global agents (agentDir/agents) first, project agents (.pi/agents,
 * trust-gated) override on name collision. Read fresh on every spawn so
 * role edits apply without a reload. Built-in worker is always present
 * unless a file overrides it.
 */
export function loadAgentDefinitions(options: {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
}): Map<string, AgentDefinition> {
  const definitions = new Map<string, AgentDefinition>([["worker", WORKER]]);
  loadDir(path.join(options.agentDir, "agents"), definitions);
  if (options.projectTrusted) {
    loadDir(path.join(options.cwd, ".pi", "agents"), definitions);
  }
  return definitions;
}
