/**
 * git-info — branch, dirty-file count, and open-PR info in the footer.
 *
 * Refreshes on session start, user input, and after every tool execution,
 * plus a slow poll so external changes (checkouts in another terminal)
 * show up. `gh pr view` runs only when the branch changes or on /pr.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { makeRefreshCoordinator } from "./src/coordinator.ts";
import { runCommand } from "./src/process.ts";
import {
  countChangedFiles,
  emptyGitInfoState,
  formatGitStatus,
  parsePullRequestJson,
} from "./src/state.ts";

const POLL_INTERVAL_MS = 3_000;
const GIT_TIMEOUT_MS = 3_000;
const GH_TIMEOUT_MS = 10_000;

export default function gitInfo(pi: ExtensionAPI) {
  let state = emptyGitInfoState();
  let generation = 0;
  let queriedPrBranch: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const coordinator = makeRefreshCoordinator();

  const publish = (ctx: ExtensionContext) => {
    ctx.ui.setStatus("git", formatGitStatus(state));
  };

  async function refreshOnce(
    ctx: ExtensionContext,
    forcePullRequest: boolean,
    refreshGeneration: number,
  ) {
    if (refreshGeneration !== generation) return;

    const repo = await runCommand(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      ctx.cwd,
      GIT_TIMEOUT_MS,
    );
    if (refreshGeneration !== generation) return;

    if (repo.code !== 0 || repo.stdout.trim() !== "true") {
      queriedPrBranch = null;
      state = emptyGitInfoState();
      publish(ctx);
      return;
    }

    const [branchResult, headResult, statusResult] = await Promise.all([
      runCommand("git", ["branch", "--show-current"], ctx.cwd, GIT_TIMEOUT_MS),
      runCommand(
        "git",
        ["rev-parse", "--short", "HEAD"],
        ctx.cwd,
        GIT_TIMEOUT_MS,
      ),
      runCommand(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        ctx.cwd,
        GIT_TIMEOUT_MS,
      ),
    ]);
    if (refreshGeneration !== generation) return;

    const branchName = branchResult.stdout.trim();
    const shortHead = headResult.stdout.trim();
    const branch =
      branchName || (shortHead ? `detached@${shortHead}` : "detached");
    const branchChanged = branchName !== queriedPrBranch;

    state = {
      ...state,
      isRepository: true,
      branch,
      changedFiles:
        statusResult.code === 0 ? countChangedFiles(statusResult.stdout) : 0,
      // queriedPrBranch is never "", so a detached head always clears the PR.
      pullRequest: branchChanged ? null : state.pullRequest,
    };
    publish(ctx);

    if (!branchName) {
      queriedPrBranch = null;
      return;
    }

    if (forcePullRequest || branchChanged) {
      queriedPrBranch = branchName;
      const result = await runCommand(
        "gh",
        ["pr", "view", branchName, "--json", "number,url,state,isDraft"],
        ctx.cwd,
        GH_TIMEOUT_MS,
      );
      if (refreshGeneration !== generation) return;
      state = {
        ...state,
        pullRequest:
          result.code === 0 ? parsePullRequestJson(result.stdout) : null,
      };
      publish(ctx);
    }
  }

  const refresh = (ctx: ExtensionContext, forcePullRequest = false) =>
    coordinator.run(() => refreshOnce(ctx, forcePullRequest, generation));

  const refreshIfIdle = (ctx: ExtensionContext) =>
    coordinator.runIfIdle(() => refreshOnce(ctx, false, generation));

  // Background refreshes must never surface as unhandled rejections.
  const inBackground = (work: Promise<void>) => {
    void work.catch(() => {});
  };

  pi.on("session_start", async (_event, ctx) => {
    generation += 1;
    queriedPrBranch = null;
    if (pollTimer) clearInterval(pollTimer);

    await refresh(ctx);
    pollTimer = setInterval(
      () => inBackground(refreshIfIdle(ctx)),
      POLL_INTERVAL_MS,
    );
    pollTimer.unref?.();
  });

  pi.on("input", (_event, ctx) => {
    inBackground(refreshIfIdle(ctx));
    return { action: "continue" };
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    inBackground(refreshIfIdle(ctx));
  });

  pi.on("session_shutdown", () => {
    generation += 1;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  });

  pi.registerCommand("pr", {
    description: "Refresh git and pull request information",
    handler: async (_args, ctx) => {
      await refresh(ctx, true);
      if (!state.isRepository) {
        ctx.ui.notify("Not a git repository", "warning");
      } else if (state.pullRequest) {
        ctx.ui.notify(
          `PR #${state.pullRequest.number}: ${state.pullRequest.url}`,
          "info",
        );
      } else {
        ctx.ui.notify(`No open PR found for ${state.branch}`, "info");
      }
    },
  });
}
