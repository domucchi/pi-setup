/**
 * /workflows dashboard: a three-level overlay.
 *
 *   Level 1 — Runs list (skipped when there is exactly one run):
 *   Workflows                                                  2 runs
 *   ╭ Runs ─────────────────────────────────────────────────────────╮
 *   │ ❯ ◆ review-diff  wf-27bc19e9      3/5 agents · 31s · running  │
 *   ╰────────────────────────────────────────────────────────────────╯
 *
 *   Level 2 — Phases │ agents (two panes):
 *   review-diff                            3/5 agents · 31s · running
 *   description                                            Σ 45.2k tok
 *   ╭ Phases ───────────╮ ╭ Verify · 2 agents ─────────────────────╮
 *   │ ❯ ✓ Triage    3/3 │ │ ❯ ◆ check-auth   gpt-5.6 · 12k tok  8s │
 *   │   ◆ Verify    1/2 │ │   ✓ check-perf   gpt-5.6 · 9k tok  14s │
 *   ╰───────────────────╯ ╰────────────────────────────────────────╯
 *
 *   Level 3 — agent detail (prompt with expand, activity, outcome).
 *
 * Pure layout logic lives in src/view.ts and shared/agent-format.ts;
 * this file owns input handling and theming.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  formatDuration,
  formatTokens,
  promptPreview,
  windowSlice,
} from "../shared/agent-format.ts";
import {
  dashboardHeight,
  panel,
  split,
  type OverlayTheme,
} from "../shared/overlay.ts";
import type { RunRecord } from "./src/artifacts.ts";
import type { WorkflowPhase } from "./src/meta.ts";
import {
  agentElapsedMs,
  agentStats,
  aggregateTokens,
  groupAgentsByPhase,
  groupCounts,
  stateColorKey,
  stateIcon,
  statusColorKey,
  statusWord,
  type AgentView,
  type PhaseGroup,
} from "./src/view.ts";

const PROMPT_PREVIEW_LINES = 6;
const ACTIVITY_TAIL = 3;
const OUTCOME_PREVIEW_LINES = 8;
const NOTICE_TTL_MS = 3_000;

/** Plain-data snapshot of a run; re-read every render so it stays live. */
export interface RunView {
  record: RunRecord;
  phases?: WorkflowPhase[];
  currentPhase?: string;
  agents: AgentView[];
  logs: string[];
  dir: string;
}

export interface DashboardHost {
  /** All of this session's runs, newest first. */
  getRuns(): RunView[];
  /** Request an abort of a run (no-op when already settled). */
  stop(runId: string): void;
}

export function showWorkflowsDashboard(
  ctx: ExtensionContext,
  host: DashboardHost,
): Promise<void> {
  return ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const dashboard = new WorkflowsDashboard(tui, theme, host, () => {
        dashboard.dispose();
        done(undefined);
      });
      return dashboard;
    },
    {
      overlay: true,
      overlayOptions: { anchor: "top-center", width: "100%", maxHeight: "100%" },
    },
  );
}

type Level = "list" | "panes" | "agent";
type PaneFocus = "phases" | "agents";

class WorkflowsDashboard {
  private level: Level = "list";
  private focus: PaneFocus = "phases";
  private listIndex = 0;
  private currentRunId?: string;
  private phaseIndex = 0;
  private agentIndex = 0;
  private detailScroll = 0;
  private detailRowCount = 0;
  private detailViewport = 1;
  private promptExpanded = false;
  private notice?: string;
  private noticeAt = 0;
  private disposed = false;
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    private readonly theme: OverlayTheme,
    private readonly host: DashboardHost,
    private readonly close: () => void,
  ) {
    // One run — the common case — goes straight to its detail; esc still
    // reaches the list level.
    const runs = host.getRuns();
    if (runs.length === 1) {
      this.currentRunId = runs[0].record.runId;
      this.level = "panes";
    }
    this.ticker = setInterval(() => this.tui.requestRender(), 500);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.ticker);
  }

  invalidate() {}

  private currentRun(): RunView | undefined {
    return this.host
      .getRuns()
      .find((run) => run.record.runId === this.currentRunId);
  }

  private groups(run: RunView): PhaseGroup[] {
    return groupAgentsByPhase(run.phases, run.agents);
  }

  private clampSelection(groups: PhaseGroup[]) {
    this.phaseIndex = Math.min(this.phaseIndex, Math.max(0, groups.length - 1));
    const agents = groups[this.phaseIndex]?.agents ?? [];
    this.agentIndex = Math.min(this.agentIndex, Math.max(0, agents.length - 1));
  }

  private selectedAgent(run: RunView): AgentView | undefined {
    const groups = this.groups(run);
    this.clampSelection(groups);
    return groups[this.phaseIndex]?.agents[this.agentIndex];
  }

  private setNotice(text: string) {
    this.notice = text;
    this.noticeAt = Date.now();
  }

  private stop(run: RunView | undefined) {
    if (!run) return;
    if (run.record.status !== "running") {
      this.setNotice("run is not running");
      return;
    }
    this.host.stop(run.record.runId);
    this.setNotice(`stopping ${run.record.name}…`);
  }

  handleInput(data: string) {
    const up = matchesKey(data, Key.up) || data === "k";
    const down = matchesKey(data, Key.down) || data === "j";
    const left = matchesKey(data, Key.left) || data === "h";
    const right = matchesKey(data, Key.right) || data === "l";
    const confirm = matchesKey(data, Key.enter);
    const cancel = matchesKey(data, Key.escape) || data === "q";

    if (this.level === "list") {
      const runs = this.host.getRuns();
      this.listIndex = Math.min(this.listIndex, Math.max(0, runs.length - 1));
      if (up || down) {
        const delta = up ? -1 : 1;
        if (runs.length > 0) {
          this.listIndex = (this.listIndex + delta + runs.length) % runs.length;
        }
      } else if (data === "x") {
        this.stop(runs[this.listIndex]);
      } else if (confirm && runs.length > 0) {
        this.currentRunId = runs[this.listIndex].record.runId;
        this.level = "panes";
        this.focus = "phases";
        this.phaseIndex = 0;
        this.agentIndex = 0;
      } else if (cancel) {
        this.close();
        return;
      }
      this.tui.requestRender();
      return;
    }

    const run = this.currentRun();
    if (!run) {
      this.level = "list";
      this.tui.requestRender();
      return;
    }

    if (data === "x") {
      this.stop(run);
      this.tui.requestRender();
      return;
    }

    if (this.level === "agent") {
      const maxScroll = Math.max(0, this.detailRowCount - this.detailViewport);
      const page = Math.max(1, this.detailViewport - 2);
      if (up) this.detailScroll = Math.max(0, this.detailScroll - 1);
      else if (down) this.detailScroll = Math.min(maxScroll, this.detailScroll + 1);
      else if (matchesKey(data, Key.ctrl("u"))) {
        this.detailScroll = Math.max(0, this.detailScroll - page);
      } else if (matchesKey(data, Key.ctrl("d"))) {
        this.detailScroll = Math.min(maxScroll, this.detailScroll + page);
      } else if (data === "p") {
        this.promptExpanded = !this.promptExpanded;
        this.detailScroll = 0;
      } else if (cancel || left) {
        this.level = "panes";
        this.focus = "agents";
      }
      this.tui.requestRender();
      return;
    }

    const groups = this.groups(run);
    this.clampSelection(groups);
    const agents = groups[this.phaseIndex]?.agents ?? [];

    if (this.focus === "phases") {
      if (up || down) {
        const delta = up ? -1 : 1;
        if (groups.length > 0) {
          this.phaseIndex = (this.phaseIndex + delta + groups.length) % groups.length;
          this.agentIndex = 0;
        }
      } else if (right || (confirm && agents.length > 0)) {
        if (agents.length > 0) this.focus = "agents";
      } else if (cancel) {
        this.level = "list";
        const runs = this.host.getRuns();
        const index = runs.findIndex((r) => r.record.runId === this.currentRunId);
        if (index >= 0) this.listIndex = index;
      }
    } else {
      if (up || down) {
        const delta = up ? -1 : 1;
        if (agents.length > 0) {
          this.agentIndex = (this.agentIndex + delta + agents.length) % agents.length;
        }
      } else if (left || cancel) {
        this.focus = "phases";
      } else if (confirm && agents.length > 0) {
        this.level = "agent";
        this.detailScroll = 0;
        this.promptExpanded = false;
      }
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = dashboardHeight(this.tui);
    if (this.notice && Date.now() - this.noticeAt > NOTICE_TTL_MS) {
      this.notice = undefined;
    }
    let lines: string[];
    const run = this.level === "list" ? undefined : this.currentRun();
    if (this.level === "agent" && run && this.selectedAgent(run)) {
      lines = this.renderAgentDetail(run, this.selectedAgent(run)!, width, height);
    } else if (this.level !== "list" && run) {
      lines = this.renderPanes(run, width, height);
    } else {
      lines = this.renderList(width, height);
    }
    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  private hintLine(hint: string, width: number): string {
    if (this.notice) {
      return truncateToWidth(this.theme.fg("accent", ` ${this.notice}`), width);
    }
    return truncateToWidth(this.theme.fg("dim", ` ${hint}`), width);
  }

  private renderList(width: number, height: number): string[] {
    const theme = this.theme;
    const runs = this.host.getRuns();
    this.listIndex = Math.min(this.listIndex, Math.max(0, runs.length - 1));

    const lines = [
      split(
        " " + theme.bold(theme.fg("accent", "Workflows")),
        theme.fg("dim", `${runs.length} run${runs.length === 1 ? "" : "s"} `),
        width,
      ),
      "",
    ];
    const panelHeight = Math.max(3, height - 3);
    const bodyHeight = Math.max(0, panelHeight - 2);

    if (runs.length === 0) {
      lines.push(
        ...panel(
          theme,
          "Runs",
          [theme.fg("dim", " no workflow runs this session")],
          width,
          panelHeight,
        ),
      );
      lines.push(this.hintLine("esc close", width));
      return lines;
    }

    const window = windowSlice(runs, this.listIndex, bodyHeight);
    const rows = window.items.map((run, i) => {
      const index = window.offset + i;
      const selected = index === this.listIndex;
      const record = run.record;
      const marker = selected ? theme.fg("accent", "❯") : " ";
      const icon = theme.fg(
        statusColorKey(record.status),
        record.status === "running" ? "◆" : record.status === "completed" ? "✓" : "✗",
      );
      const name = theme.fg(selected ? "accent" : "text", record.name);
      const counts = groupCounts(run.agents);
      const settled = counts.done + counts.failed;
      const elapsed = formatDuration(
        (record.settledAt ?? Date.now()) - record.startedAt,
      );
      const right =
        theme.fg("dim", `${settled}/${counts.total} agents · ${elapsed} · `) +
        theme.fg(statusColorKey(record.status), statusWord(record.status)) +
        " ";
      return split(
        ` ${marker} ${icon} ${name} ${theme.fg("dim", record.runId)}`,
        right,
        width - 2,
      );
    });
    lines.push(...panel(theme, "Runs", rows, width, panelHeight));
    lines.push(
      this.hintLine("↑↓ select · enter open · x stop · esc close", width),
    );
    return lines;
  }

  /** Two header lines shared by the panes and agent levels. */
  private header(run: RunView, width: number): string[] {
    const theme = this.theme;
    const record = run.record;
    const counts = groupCounts(run.agents);
    const settled = counts.done + counts.failed;
    const elapsed = formatDuration(
      (record.settledAt ?? Date.now()) - record.startedAt,
    );
    const right =
      theme.fg("dim", `${settled}/${counts.total} agents · ${elapsed} · `) +
      theme.fg(statusColorKey(record.status), statusWord(record.status)) +
      " ";
    const first = split(
      " " + theme.bold(theme.fg("accent", record.name)),
      right,
      width,
    );
    const totalTokens = formatTokens(aggregateTokens(run.agents));
    const second = split(
      " " + theme.fg("muted", record.description),
      totalTokens ? theme.fg("dim", `Σ ${totalTokens} `) : " ",
      width,
    );
    return [first, second];
  }

  private renderPanes(run: RunView, width: number, height: number): string[] {
    const theme = this.theme;
    const lines = this.header(run, width);

    const groups = this.groups(run);
    this.clampSelection(groups);
    const selectedGroup = groups[this.phaseIndex];

    const panelHeight = Math.max(3, height - 3);
    const bodyHeight = Math.max(0, panelHeight - 2);

    // Left: phases sidebar.
    const maxTitle = Math.max(8, ...groups.map((g) => g.title.length));
    const sidebarWidth = Math.min(
      Math.max(maxTitle + 12, 20),
      Math.floor(width / 3),
    );
    const sidebarInner = sidebarWidth - 2;
    const phaseWindow = windowSlice(groups, this.phaseIndex, bodyHeight);
    const phaseRows = phaseWindow.items.map((group, i) => {
      const index = phaseWindow.offset + i;
      const selected = index === this.phaseIndex;
      const focused = selected && this.focus === "phases";
      const marker = selected
        ? theme.fg(focused ? "accent" : "muted", "❯")
        : " ";
      const counts = groupCounts(group.agents);
      const icon =
        counts.total === 0
          ? theme.fg("dim", "·")
          : counts.running > 0
            ? theme.fg("warning", "◆")
            : counts.failed > 0
              ? theme.fg("error", "✗")
              : theme.fg("success", "✓");
      const isCurrent =
        run.record.status === "running" && group.title === run.currentPhase;
      const title = focused
        ? theme.fg("accent", group.title)
        : theme.fg(isCurrent ? "text" : "muted", group.title);
      const countText =
        counts.total > 0
          ? theme.fg("dim", `${counts.done + counts.failed}/${counts.total} `)
          : theme.fg("dim", "- ");
      return split(` ${marker} ${icon} ${title}`, countText, sidebarInner);
    });

    // Right: agents in the selected phase.
    const agentsWidth = width - sidebarWidth - 1;
    const agentsInner = agentsWidth - 2;
    const agentRows: string[] = [];
    if (selectedGroup) {
      const agentWindow = windowSlice(
        selectedGroup.agents,
        this.agentIndex,
        bodyHeight,
      );
      const maxLabel = Math.min(
        40,
        Math.max(0, ...selectedGroup.agents.map((a) => a.label.length)),
      );
      for (const [i, agent] of agentWindow.items.entries()) {
        const index = agentWindow.offset + i;
        const selected = index === this.agentIndex && this.focus === "agents";
        const marker = selected ? theme.fg("accent", "❯") : " ";
        const icon = theme.fg(stateColorKey(agent.state), stateIcon(agent.state));
        const label = theme.fg(
          selected ? "accent" : "text",
          agent.label.padEnd(maxLabel),
        );
        const stats = agentStats(agent);
        const left = ` ${marker} ${icon} ${label}${stats ? `  ${theme.fg("dim", stats)}` : ""}`;
        const right = theme.fg(
          "dim",
          `${formatDuration(agentElapsedMs(agent, Date.now()))} `,
        );
        agentRows.push(split(left, right, agentsInner));
        if (agent.error) {
          agentRows.push(
            truncateToWidth(
              `      ${theme.fg("error", agent.error)}`,
              agentsInner,
              "…",
            ),
          );
        }
      }
      if (selectedGroup.agents.length === 0) {
        agentRows.push(theme.fg("dim", " no agents in this phase yet"));
      }
    }
    if (run.record.error) {
      agentRows.push("");
      agentRows.push(theme.fg("error", ` workflow error: ${run.record.error}`));
    }
    const lastLog = run.logs.at(-1);
    if (lastLog && run.record.status === "running") {
      agentRows.push("");
      agentRows.push(theme.fg("dim", ` log: ${lastLog}`));
    }

    const counts = groupCounts(selectedGroup?.agents ?? []);
    const agentsTitle = selectedGroup
      ? `${selectedGroup.title} · ${counts.total} agent${counts.total === 1 ? "" : "s"}`
      : "Agents";
    const leftPanel = panel(theme, "Phases", phaseRows, sidebarWidth, panelHeight);
    const rightPanel = panel(theme, agentsTitle, agentRows, agentsWidth, panelHeight);
    for (let i = 0; i < panelHeight; i++) {
      lines.push(`${leftPanel[i] ?? ""} ${rightPanel[i] ?? ""}`);
    }

    const stopHint = run.record.status === "running" ? "x stop · " : "";
    const hint =
      this.focus === "phases"
        ? `↑↓ select · → agents · ${stopHint}esc back`
        : `↑↓ select · enter detail · ← phases · ${stopHint}esc back`;
    lines.push(this.hintLine(hint, width));
    return lines;
  }

  private renderAgentDetail(
    run: RunView,
    agent: AgentView,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const lines: string[] = [];

    // Header: label + live stats; sub-line locates the agent in the run.
    const stateWord =
      agent.state === "running" ? "running" : agent.state === "ok" ? "done" : "failed";
    const statParts = [
      agentStats(agent),
      formatDuration(agentElapsedMs(agent, Date.now())),
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(
      split(
        ` ${theme.fg(stateColorKey(agent.state), stateIcon(agent.state))} ${theme.bold(theme.fg("accent", agent.label))}` +
          `  ${theme.fg(stateColorKey(agent.state), stateWord)}`,
        theme.fg("dim", `${statParts} `),
        width,
      ),
    );
    const percent =
      agent.tokens !== undefined && agent.contextWindow
        ? ` · ${Math.round((agent.tokens / agent.contextWindow) * 100)}% of ${Math.round(agent.contextWindow / 1000)}k`
        : "";
    lines.push(
      " " +
        theme.fg(
          "muted",
          `${run.record.name} · ${agent.phase ?? "unphased"} · ${agent.agentType ?? "worker"}${percent}`,
        ),
    );

    const panelHeight = Math.max(3, height - 3);
    const bodyHeight = Math.max(1, panelHeight - 2);
    const inner = Math.max(8, width - 4);

    // Body sections: Prompt, Activity, Outcome.
    const rows: string[] = [];
    const preview = promptPreview(
      agent.prompt,
      this.promptExpanded ? 0 : PROMPT_PREVIEW_LINES,
    );
    const promptHint = preview.clipped
      ? " · p to expand"
      : this.promptExpanded && preview.totalLines > PROMPT_PREVIEW_LINES
        ? " · p to collapse"
        : "";
    rows.push(
      theme.bold(theme.fg("text", " Prompt")) +
        theme.fg(
          "dim",
          ` · ${preview.totalLines} line${preview.totalLines === 1 ? "" : "s"}${promptHint}`,
        ),
    );
    if (preview.lines.length === 0) {
      rows.push(theme.fg("dim", "   (no prompt recorded)"));
    }
    for (const line of preview.lines) {
      if (this.promptExpanded) {
        for (const wrapped of wrapTextWithAnsi(theme.fg("text", line || " "), inner)) {
          rows.push(`   ${wrapped}`);
        }
      } else {
        rows.push(`   ${theme.fg("text", truncateToWidth(line, inner, "…"))}`);
      }
    }
    if (preview.clipped) {
      rows.push(
        theme.fg("dim", `   … ${preview.totalLines - preview.lines.length} more lines`),
      );
    }

    rows.push("");
    rows.push(theme.bold(theme.fg("text", " Activity")));
    const tail = agent.activity.slice(-ACTIVITY_TAIL);
    if (tail.length === 0) {
      rows.push(theme.fg("dim", "   (no tool calls yet)"));
    }
    for (const entry of tail) {
      const color = entry.startsWith("✗")
        ? "error"
        : entry.startsWith("✓")
          ? "success"
          : "warning";
      rows.push(`   ${theme.fg(color, entry)}`);
    }

    rows.push("");
    rows.push(theme.bold(theme.fg("text", " Outcome")));
    if (agent.state === "running") {
      rows.push(theme.fg("dim", "   still working…"));
    } else if (agent.error) {
      for (const line of wrapTextWithAnsi(theme.fg("error", agent.error), inner)) {
        rows.push(`   ${line}`);
      }
    }
    if (agent.output) {
      const outputLines = agent.output.split("\n").slice(0, OUTCOME_PREVIEW_LINES);
      for (const line of outputLines) {
        rows.push(`   ${theme.fg("text", truncateToWidth(line, inner, "…"))}`);
      }
      const total = agent.output.split("\n").length;
      if (total > outputLines.length) {
        rows.push(theme.fg("dim", `   … full report in ${run.dir}/agents/`));
      }
    } else if (agent.state === "ok") {
      rows.push(theme.fg("dim", "   (no report text)"));
    }

    this.detailRowCount = rows.length;
    this.detailViewport = bodyHeight;
    const maxScroll = Math.max(0, rows.length - bodyHeight);
    this.detailScroll = Math.min(this.detailScroll, maxScroll);
    const visible = rows.slice(this.detailScroll, this.detailScroll + bodyHeight);
    const title =
      rows.length > bodyHeight
        ? `Agent · ${this.detailScroll + 1}-${Math.min(rows.length, this.detailScroll + bodyHeight)}/${rows.length}`
        : "Agent";
    lines.push(...panel(theme, title, visible, width, panelHeight));

    const stopHint = run.record.status === "running" ? "x stop · " : "";
    lines.push(this.hintLine(`↑↓ scroll · p prompt · ${stopHint}esc back`, width));
    return lines;
  }
}
