import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Resolve a saved workflow by name: .pi/workflows first, then
 * .claude/workflows (Claude Code compatibility, read-only).
 */
export function resolveNamedWorkflow(
  name: string,
  cwd: string,
): { source: string; path: string } | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(
      `Invalid workflow name "${name}" — letters, digits, dots, dashes, underscores only.`,
    );
  }
  const candidates = [
    path.join(cwd, ".pi", "workflows", `${name}.js`),
    path.join(cwd, ".pi", "workflows", `${name}.mjs`),
    path.join(cwd, ".claude", "workflows", `${name}.js`),
    path.join(cwd, ".claude", "workflows", `${name}.mjs`),
  ];
  for (const file of candidates) {
    try {
      return { source: readFileSync(file, "utf8"), path: file };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
