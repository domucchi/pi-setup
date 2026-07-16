/** Pure builders: tool params → CLI argument lists. */

export interface FdParams {
  pattern?: string;
  path?: string;
  type?: "file" | "directory" | "symlink";
  extension?: string;
  glob?: boolean;
  hidden?: boolean;
  max_depth?: number;
  limit?: number;
}

export const FD_DEFAULT_LIMIT = 1000;

export function buildFdArgs(params: FdParams) {
  const args = ["--color=never"];
  if (params.glob) args.push("--glob");
  if (params.hidden) args.push("--hidden");
  if (params.type) args.push("--type", params.type);
  if (params.extension) args.push("--extension", params.extension);
  if (params.max_depth !== undefined) {
    args.push("--max-depth", String(params.max_depth));
  }
  args.push("--max-results", String(params.limit ?? FD_DEFAULT_LIMIT));
  // fd requires a pattern before a search path; "." matches everything.
  args.push(params.pattern ?? ".");
  if (params.path) args.push(params.path);
  return args;
}

export interface RgParams {
  pattern: string;
  path?: string;
  glob?: string;
  file_type?: string;
  case_sensitive?: boolean;
  fixed_strings?: boolean;
  hidden?: boolean;
  context?: number;
  limit?: number;
}

export const RG_DEFAULT_LIMIT = 100;

export function buildRgArgs(params: RgParams) {
  const args = ["--color=never", "--line-number", "--no-heading"];
  if (params.case_sensitive === true) args.push("--case-sensitive");
  else if (params.case_sensitive === false) args.push("--ignore-case");
  else args.push("--smart-case");
  if (params.fixed_strings) args.push("--fixed-strings");
  if (params.hidden) args.push("--hidden");
  if (params.glob) args.push("--glob", params.glob);
  if (params.file_type) args.push("--type", params.file_type);
  if (params.context !== undefined) {
    args.push("--context", String(params.context));
  }
  args.push("--max-count", String(params.limit ?? RG_DEFAULT_LIMIT));
  // "--" so patterns starting with "-" are never parsed as flags.
  args.push("--", params.pattern);
  if (params.path) args.push(params.path);
  return args;
}
