export interface PullRequestInfo {
  /** "pr" for GitHub pull requests, "mr" for GitLab merge requests. */
  kind: "pr" | "mr";
  number: number;
  url: string;
  isDraft: boolean;
}

export interface GitInfoState {
  isRepository: boolean;
  branch: string | null;
  changedFiles: number;
  pullRequest: PullRequestInfo | null;
}

export function emptyGitInfoState(): GitInfoState {
  return {
    isRepository: false,
    branch: null,
    changedFiles: 0,
    pullRequest: null,
  };
}

/** Count entries in `git status --porcelain=v1` output. */
export function countChangedFiles(status: string) {
  if (!status.trim()) return 0;
  return status.split("\n").filter(Boolean).length;
}

function parseJson(json: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(json);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parse `gh pr view --json number,url,state,isDraft`; only OPEN PRs count. */
export function parseGitHubPrJson(json: string): PullRequestInfo | null {
  const record = parseJson(json);
  if (!record) return null;
  if (typeof record.number !== "number") return null;
  if (typeof record.url !== "string") return null;
  if (record.state !== "OPEN") return null;

  return {
    kind: "pr",
    number: record.number,
    url: record.url,
    isDraft: record.isDraft === true,
  };
}

/** Parse `glab mr view --output json`; only opened MRs count. */
export function parseGitLabMrJson(json: string): PullRequestInfo | null {
  const record = parseJson(json);
  if (!record) return null;
  // GitLab: iid is the !N number, web_url the link, state "opened".
  if (typeof record.iid !== "number") return null;
  if (typeof record.web_url !== "string") return null;
  if (record.state !== "opened") return null;

  return {
    kind: "mr",
    number: record.iid,
    url: record.web_url,
    // GitLab moved from work_in_progress to draft; accept either.
    isDraft: record.draft === true || record.work_in_progress === true,
  };
}

/**
 * Footer text; undefined clears the status segment. Pi's built-in footer
 * already shows the branch, so we only add dirty count and PR info.
 */
export function formatGitStatus(state: GitInfoState) {
  if (!state.isRepository) return undefined;
  const parts: string[] = [];
  if (state.changedFiles > 0) parts.push(`±${state.changedFiles}`);
  if (state.pullRequest) {
    const { kind, number, isDraft } = state.pullRequest;
    const ref = kind === "mr" ? `MR!${number}` : `PR#${number}`;
    parts.push(`${ref}${isDraft ? " (draft)" : ""}`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
