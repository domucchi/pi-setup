/**
 * file-search — fd (names) and rg (contents) as first-class tools.
 *
 * Uses system binaries only; a missing binary fails the call with an
 * install hint. Output is capped at 2000 lines / 50KB; capped results
 * save the complete output to a temp file and return its path.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  previewOf,
  renderCompactResult,
  resultText,
} from "../shared/compact-result.ts";
import { runCommand } from "../shared/process.ts";
import {
  FD_DESCRIPTION,
  FD_PARAMETER_DESCRIPTIONS,
  FD_PROMPT_GUIDELINES,
  FD_PROMPT_SNIPPET,
  MISSING_BINARY_HINT,
  RG_DESCRIPTION,
  RG_PARAMETER_DESCRIPTIONS,
  RG_PROMPT_GUIDELINES,
  RG_PROMPT_SNIPPET,
} from "./prompt.ts";
import { buildFdArgs, buildRgArgs } from "./src/args.ts";
import { capOutput } from "./src/cap.ts";

const SEARCH_TIMEOUT_MS = 30_000;
// Stop a search after ~4MB of stdout — well above the 50KB shown to the
// model, but bounded so a runaway pattern can't exhaust memory.
const PROCESS_STDOUT_BUDGET = 4 * 1024 * 1024;
let overflowCounter = 0;

function saveOverflow(tool: string, full: string) {
  const dir = path.join(tmpdir(), "pi-file-search", `pid-${process.pid}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  overflowCounter += 1;
  const file = path.join(dir, `${tool}-${overflowCounter}.txt`);
  writeFileSync(file, full, { mode: 0o600 });
  return file;
}

async function runSearch(
  binary: "fd" | "rg",
  args: string[],
  cwd: string,
  emptyMessage: string,
  signal?: AbortSignal,
) {
  // Bound memory: stop the search once stdout passes the byte budget
  // (rg --max-count is per-file, so a broad pattern can still flood).
  const result = await runCommand(binary, args, cwd, SEARCH_TIMEOUT_MS, {
    maxStdoutBytes: PROCESS_STDOUT_BUDGET,
    signal,
  });
  if (result.code === -1) {
    throw new Error(`${binary} timed out after ${SEARCH_TIMEOUT_MS / 1000}s. Narrow the search.`);
  }
  if (result.stderr.includes("Failed to run")) {
    throw new Error(MISSING_BINARY_HINT[binary]);
  }
  // rg exits 1 on "no matches"; fd exits 0 with empty output.
  if (result.code === 1 && binary === "rg" && !result.stdout) {
    return { text: emptyMessage, matches: 0 };
  }
  if (result.code !== 0 && !result.truncated && !(binary === "rg" && result.code === 1)) {
    throw new Error(
      `${binary} failed (exit ${result.code}): ${result.stderr.trim() || "unknown error"}`,
    );
  }
  const full = result.stdout;
  if (!full.trim()) return { text: emptyMessage, matches: 0 };

  const capped = capOutput(full);
  let text = capped.text;
  if (capped.truncated || result.truncated) {
    const file = saveOverflow(binary, full);
    const suffix = result.truncated
      ? ` — search stopped early at the ${Math.round(PROCESS_STDOUT_BUDGET / 1024)}KB budget; narrow the pattern`
      : "";
    text += `\n\n[output capped at ${text.split("\n").length} of ${capped.totalLines}+ lines${suffix} — partial output saved to ${file}]`;
  }
  return { text, matches: capped.totalLines };
}

export default function fileSearch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "fd",
    label: "Find Files",
    description: FD_DESCRIPTION,
    promptSnippet: FD_PROMPT_SNIPPET,
    promptGuidelines: FD_PROMPT_GUIDELINES,
    parameters: Type.Object({
      pattern: Type.Optional(
        Type.String({ description: FD_PARAMETER_DESCRIPTIONS.pattern }),
      ),
      path: Type.Optional(
        Type.String({ description: FD_PARAMETER_DESCRIPTIONS.path }),
      ),
      type: Type.Optional(
        Type.Union(
          [
            Type.Literal("file"),
            Type.Literal("directory"),
            Type.Literal("symlink"),
          ],
          { description: FD_PARAMETER_DESCRIPTIONS.type },
        ),
      ),
      extension: Type.Optional(
        Type.String({ description: FD_PARAMETER_DESCRIPTIONS.extension }),
      ),
      glob: Type.Optional(
        Type.Boolean({ description: FD_PARAMETER_DESCRIPTIONS.glob }),
      ),
      hidden: Type.Optional(
        Type.Boolean({ description: FD_PARAMETER_DESCRIPTIONS.hidden }),
      ),
      max_depth: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 64,
          description: FD_PARAMETER_DESCRIPTIONS.max_depth,
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 10_000,
          description: FD_PARAMETER_DESCRIPTIONS.limit,
        }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { text, matches } = await runSearch(
        "fd",
        buildFdArgs(params),
        ctx.cwd,
        "No files matched.",
        signal,
      );
      return {
        content: [{ type: "text" as const, text }],
        details: { matches },
      };
    },
    // The full path list matters to the model, not the human: collapse to
    // a count (ctrl+o expands).
    renderResult(result, options, theme) {
      const matches = (result.details as { matches?: number } | undefined)?.matches ?? 0;
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        summary: matches === 0 ? "no matches" : `→ ${matches} file${matches === 1 ? "" : "s"}`,
        fullText: resultText(result),
      });
    },
  });

  pi.registerTool({
    name: "rg",
    label: "Search Contents",
    description: RG_DESCRIPTION,
    promptSnippet: RG_PROMPT_SNIPPET,
    promptGuidelines: RG_PROMPT_GUIDELINES,
    parameters: Type.Object({
      pattern: Type.String({
        description: RG_PARAMETER_DESCRIPTIONS.pattern,
      }),
      path: Type.Optional(
        Type.String({ description: RG_PARAMETER_DESCRIPTIONS.path }),
      ),
      glob: Type.Optional(
        Type.String({ description: RG_PARAMETER_DESCRIPTIONS.glob }),
      ),
      file_type: Type.Optional(
        Type.String({ description: RG_PARAMETER_DESCRIPTIONS.file_type }),
      ),
      case_sensitive: Type.Optional(
        Type.Boolean({
          description: RG_PARAMETER_DESCRIPTIONS.case_sensitive,
        }),
      ),
      fixed_strings: Type.Optional(
        Type.Boolean({
          description: RG_PARAMETER_DESCRIPTIONS.fixed_strings,
        }),
      ),
      hidden: Type.Optional(
        Type.Boolean({ description: RG_PARAMETER_DESCRIPTIONS.hidden }),
      ),
      context: Type.Optional(
        Type.Number({
          minimum: 0,
          maximum: 20,
          description: RG_PARAMETER_DESCRIPTIONS.context,
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 1_000,
          description: RG_PARAMETER_DESCRIPTIONS.limit,
        }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { text, matches } = await runSearch(
        "rg",
        buildRgArgs(params),
        ctx.cwd,
        "No matches.",
        signal,
      );
      return {
        content: [{ type: "text" as const, text }],
        details: { matches },
      };
    },
    // Collapse the match dump to a count + a taste of the hits.
    renderResult(result, options, theme) {
      const matches = (result.details as { matches?: number } | undefined)?.matches ?? 0;
      const text = resultText(result);
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        summary:
          matches === 0
            ? "no matches"
            : `→ ${matches} matching line${matches === 1 ? "" : "s"}`,
        fullText: text,
        previewLines: matches > 0 ? previewOf(text, 3) : undefined,
      });
    },
  });
}
