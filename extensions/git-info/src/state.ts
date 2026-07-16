export interface PullRequestInfo {
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

/** Parse `gh pr view --json number,url,state,isDraft`; only OPEN PRs count. */
export function parsePullRequestJson(json: string): PullRequestInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.number !== "number") return null;
  if (typeof record.url !== "string") return null;
  if (record.state !== "OPEN") return null;

  return {
    number: record.number,
    url: record.url,
    isDraft: record.isDraft === true,
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
    parts.push(
      `PR#${state.pullRequest.number}${state.pullRequest.isDraft ? " (draft)" : ""}`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
