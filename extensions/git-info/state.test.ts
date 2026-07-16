import { describe, expect, it } from "vitest";
import {
  countChangedFiles,
  emptyGitInfoState,
  formatGitStatus,
  parseGitHubPrJson,
  parseGitLabMrJson,
} from "./src/state.ts";

describe("countChangedFiles", () => {
  it("returns 0 for empty output", () => {
    expect(countChangedFiles("")).toBe(0);
    expect(countChangedFiles("\n")).toBe(0);
  });

  it("counts porcelain lines, ignoring the trailing newline", () => {
    expect(countChangedFiles(" M a.ts\n?? b.ts\n")).toBe(2);
    expect(countChangedFiles(" M a.ts")).toBe(1);
  });
});

describe("parseGitHubPrJson", () => {
  it("parses an open PR", () => {
    const json = JSON.stringify({
      number: 7,
      url: "https://github.com/x/y/pull/7",
      state: "OPEN",
      isDraft: false,
    });
    expect(parseGitHubPrJson(json)).toEqual({
      kind: "pr",
      number: 7,
      url: "https://github.com/x/y/pull/7",
      isDraft: false,
    });
  });

  it("marks drafts and rejects non-open PRs", () => {
    expect(
      parseGitHubPrJson(
        JSON.stringify({ number: 7, url: "u", state: "OPEN", isDraft: true }),
      )?.isDraft,
    ).toBe(true);
    expect(
      parseGitHubPrJson(
        JSON.stringify({ number: 7, url: "u", state: "MERGED", isDraft: false }),
      ),
    ).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseGitHubPrJson("not json")).toBeNull();
    expect(parseGitHubPrJson("[]")).toBeNull();
    expect(parseGitHubPrJson(JSON.stringify({ number: "7" }))).toBeNull();
  });
});

describe("parseGitLabMrJson", () => {
  it("parses an opened MR using iid/web_url", () => {
    const json = JSON.stringify({
      iid: 42,
      web_url: "https://gitlab.com/g/p/-/merge_requests/42",
      state: "opened",
      draft: false,
    });
    expect(parseGitLabMrJson(json)).toEqual({
      kind: "mr",
      number: 42,
      url: "https://gitlab.com/g/p/-/merge_requests/42",
      isDraft: false,
    });
  });

  it("accepts draft or legacy work_in_progress", () => {
    const base = { iid: 1, web_url: "u", state: "opened" };
    expect(parseGitLabMrJson(JSON.stringify({ ...base, draft: true }))?.isDraft).toBe(
      true,
    );
    expect(
      parseGitLabMrJson(JSON.stringify({ ...base, work_in_progress: true }))?.isDraft,
    ).toBe(true);
  });

  it("rejects merged/closed MRs and GitHub-shaped JSON", () => {
    expect(
      parseGitLabMrJson(JSON.stringify({ iid: 1, web_url: "u", state: "merged" })),
    ).toBeNull();
    expect(
      parseGitLabMrJson(
        JSON.stringify({ number: 1, url: "u", state: "OPEN" }),
      ),
    ).toBeNull();
  });
});

describe("formatGitStatus", () => {
  it("clears when not a repository or clean with no change", () => {
    expect(formatGitStatus(emptyGitInfoState())).toBeUndefined();
    expect(
      formatGitStatus({
        isRepository: true,
        branch: "main",
        changedFiles: 0,
        pullRequest: null,
      }),
    ).toBeUndefined();
  });

  it("shows dirty count and a GitHub PR as PR#", () => {
    expect(
      formatGitStatus({
        isRepository: true,
        branch: "feat/x",
        changedFiles: 3,
        pullRequest: { kind: "pr", number: 42, url: "u", isDraft: false },
      }),
    ).toBe("±3 PR#42");
  });

  it("shows a GitLab MR as MR! and marks drafts", () => {
    expect(
      formatGitStatus({
        isRepository: true,
        branch: "feat/x",
        changedFiles: 0,
        pullRequest: { kind: "mr", number: 7, url: "u", isDraft: true },
      }),
    ).toBe("MR!7 (draft)");
  });
});
