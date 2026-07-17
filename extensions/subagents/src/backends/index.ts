/** Backend dispatch: pi children stay in child.ts; externals live here. */

import type { ChildHandle } from "../child.ts";
import { createClaudeChild, type ExternalChildOptions } from "./claude.ts";
import { createCodexChild } from "./codex.ts";

export type { ExternalChildOptions } from "./claude.ts";

export function createExternalChild(
  backend: "claude" | "codex",
  options: ExternalChildOptions,
): Promise<ChildHandle> {
  return backend === "claude"
    ? createClaudeChild(options)
    : createCodexChild(options);
}
