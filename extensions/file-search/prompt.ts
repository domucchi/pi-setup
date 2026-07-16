/** All model-facing text for the fd and rg tools. */

export const FD_DESCRIPTION =
  "Find files and directories by name with fd. Fast and gitignore-aware. " +
  "Results are capped (default 1000 entries; output capped at 2000 lines / 50KB) — " +
  "when capped, the complete output is saved to a file whose path is returned.";

export const FD_PROMPT_SNIPPET =
  "Find files and directories by name with fd (fast, gitignore-aware).";

export const FD_PROMPT_GUIDELINES = [
  "Use fd — not bash with find or ls -R — to discover files and directories by name, extension, or glob.",
  "Use rg when searching file contents; fd only matches names and paths.",
  "Keep bash for multi-step pipelines that post-process file listings.",
];

export const RG_DESCRIPTION =
  "Search file contents with ripgrep. Smart-case, gitignore-aware, line numbers included. " +
  "At most 100 matches per file by default; output capped at 2000 lines / 50KB — " +
  "when capped, the complete output is saved to a file whose path is returned.";

export const RG_PROMPT_SNIPPET =
  "Search file contents with ripgrep (fast regex content search).";

export const RG_PROMPT_GUIDELINES = [
  "Use rg — not bash with grep — to search file contents.",
  "Set fixed_strings when searching for literal code that contains regex metacharacters.",
  "Use fd when looking for files by name rather than content.",
];

export const FD_PARAMETER_DESCRIPTIONS = {
  pattern:
    "Regex matched against file names, or a glob when glob is true. Omit to list everything under path.",
  path: "Directory to search. Defaults to the current working directory.",
  type: "Only return entries of this type.",
  extension: "Only return files with this extension, e.g. 'ts' or 'md'.",
  glob: "Treat pattern as a glob (e.g. '*.test.ts') instead of a regex.",
  hidden: "Include hidden files and directories. Defaults to false.",
  max_depth: "Maximum directory depth to descend.",
  limit: "Maximum number of results. Defaults to 1000.",
};

export const RG_PARAMETER_DESCRIPTIONS = {
  pattern: "Regex to search for (literal text when fixed_strings is true).",
  path: "File or directory to search. Defaults to the current working directory.",
  glob: "Only search files matching this glob, e.g. '*.ts' or 'src/**'.",
  file_type: "Only search files of this ripgrep type, e.g. 'ts', 'py', 'rust'.",
  case_sensitive:
    "true forces case-sensitive, false forces case-insensitive. Defaults to smart-case.",
  fixed_strings: "Treat pattern as a literal string instead of a regex.",
  hidden: "Search hidden files and directories. Defaults to false.",
  context: "Lines of context to show around each match.",
  limit: "Maximum matches per file. Defaults to 100.",
};

export const MISSING_BINARY_HINT: Record<string, string> = {
  fd: "fd is not installed. Install it with `brew install fd` (macOS) or your package manager, then restart pi.",
  rg: "ripgrep is not installed. Install it with `brew install ripgrep` (macOS) or your package manager, then restart pi.",
};
