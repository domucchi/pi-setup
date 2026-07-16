import { describe, expect, it } from "vitest";
import {
  countChangedFiles,
  emptyGitInfoState,
  formatGitStatus,
  parsePullRequestJson,
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

describe("parsePullRequestJson", () => {
  it("parses an open PR", () => {
    const json = JSON.stringify({
      number: 7,
      url: "https://github.com/x/y/pull/7",
      state: "OPEN",
      isDraft: false,
    });
    expect(parsePullRequestJson(json)).toEqual({
      number: 7,
      url: "https://github.com/x/y/pull/7",
      isDraft: false,
    });
  });

  it("marks drafts", () => {
    const json = JSON.stringify({
      number: 7,
      url: "u",
      state: "OPEN",
      isDraft: true,
    });
    expect(parsePullRequestJson(json)?.isDraft).toBe(true);
  });

  it("rejects non-open PRs", () => {
    const json = JSON.stringify({
      number: 7,
      url: "u",
      state: "MERGED",
      isDraft: false,
    });
    expect(parsePullRequestJson(json)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parsePullRequestJson("not json")).toBeNull();
    expect(parsePullRequestJson("null")).toBeNull();
    expect(parsePullRequestJson("[]")).toBeNull();
    expect(parsePullRequestJson(JSON.stringify({ number: "7" }))).toBeNull();
  });
});

describe("formatGitStatus", () => {
  it("clears when not a repository", () => {
    expect(formatGitStatus(emptyGitInfoState())).toBeUndefined();
  });

  it("clears when clean with no PR (branch is shown by pi itself)", () => {
    expect(
      formatGitStatus({
        isRepository: true,
        branch: "main",
        changedFiles: 0,
        pullRequest: null,
      }),
    ).toBeUndefined();
  });

  it("shows dirty count and PR", () => {
    expect(
      formatGitStatus({
        isRepository: true,
        branch: "feat/x",
        changedFiles: 3,
        pullRequest: { number: 42, url: "u", isDraft: false },
      }),
    ).toBe("±3 PR#42");
  });

  it("marks draft PRs", () => {
    expect(
      formatGitStatus({
        isRepository: true,
        branch: "main",
        changedFiles: 0,
        pullRequest: { number: 1, url: "u", isDraft: true },
      }),
    ).toBe("PR#1 (draft)");
  });
});
