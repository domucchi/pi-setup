/**
 * /subagents dashboard: a two-level overlay matching the workflows one.
 *
 *   Level 1 — agent list:
 *   Subagents                                        1 working · 3 total
 *   ╭ Agents ───────────────────────────────────────────────────────╮
 *   │ ❯ ◆ audit auth   sub-1 · worker · gpt-5.6 · 12k tok  44s      │
 *   │   ✓ map repo     sub-2 · explore · gpt-5.6 · 9k tok  1m12s    │
 *   ╰────────────────────────────────────────────────────────────────╯
 *
 *   Level 2 — agent detail: prompt (p expands), recent activity,
 *   report, live transcript tail. x cancels the agent.
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
  shortModel,
  windowSlice,
} from "../shared/agent-format.ts";
import {
  dashboardHeight,
  panel,
  split,
  type OverlayTheme,
} from "../shared/overlay.ts";
import type { SubagentSnapshot, SubagentStatus } from "./src/manager.ts";

const PROMPT_PREVIEW_LINES = 6;
const ACTIVITY_TAIL = 3;
const REPORT_PREVIEW_LINES = 8;
const TRANSCRIPT_TAIL = 12;
const NOTICE_TTL_MS = 3_000;

export interface SubagentsHost {
  list(): SubagentSnapshot[];
  transcriptTail(id: string, lines: number): string[];
  /** Request cancellation (fire-and-forget; the list will reflect it). */
  cancel(id: string): void;
}

export function showSubagentsDashboard(
  ctx: ExtensionContext,
  host: SubagentsHost,
): Promise<void> {
  return ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const dashboard = new SubagentsDashboard(tui, theme, host, () => {
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

function statusIcon(status: SubagentStatus): string {
  switch (status) {
    case "working":
      return "◆";
    case "idle":
      return "✓";
    case "failed":
      return "✗";
    case "cancelled":
      return "·";
  }
}

function statusColorKey(
  status: SubagentStatus,
): "warning" | "success" | "error" | "muted" {
  switch (status) {
    case "working":
      return "warning";
    case "idle":
      return "success";
    case "failed":
      return "error";
    case "cancelled":
      return "muted";
  }
}

function statusText(snapshot: SubagentSnapshot): string {
  if (snapshot.status === "idle") {
    return snapshot.errorText === "interrupted" ? "interrupted" : "done";
  }
  return snapshot.status;
}

/** "sub-1 · worker · gpt-5.6-sol · 12.3k tok · 4 tools" for list rows. */
function snapshotStats(snapshot: SubagentSnapshot): string {
  const parts = [snapshot.id, snapshot.agentType];
  if (snapshot.model) parts.push(shortModel(snapshot.model));
  const tokens = formatTokens(snapshot.tokens ?? undefined);
  if (tokens) parts.push(tokens);
  if (snapshot.toolCalls > 0) {
    parts.push(`${snapshot.toolCalls} tool${snapshot.toolCalls === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function elapsed(snapshot: SubagentSnapshot): string {
  return formatDuration(
    (snapshot.settledAt ?? Date.now()) - snapshot.startedAt,
  );
}

type Level = "list" | "agent";

class SubagentsDashboard {
  private level: Level = "list";
  private listIndex = 0;
  private currentId?: string;
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
    private readonly host: SubagentsHost,
    private readonly close: () => void,
  ) {
    this.ticker = setInterval(() => this.tui.requestRender(), 500);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.ticker);
  }

  invalidate() {}

  private current(): SubagentSnapshot | undefined {
    return this.host.list().find((s) => s.id === this.currentId);
  }

  private setNotice(text: string) {
    this.notice = text;
    this.noticeAt = Date.now();
  }

  private cancel(snapshot: SubagentSnapshot | undefined) {
    if (!snapshot) return;
    if (snapshot.status === "cancelled") {
      this.setNotice(`${snapshot.id} is already cancelled`);
      return;
    }
    this.host.cancel(snapshot.id);
    this.setNotice(`cancelling ${snapshot.id}…`);
  }

  handleInput(data: string) {
    const up = matchesKey(data, Key.up) || data === "k";
    const down = matchesKey(data, Key.down) || data === "j";
    const left = matchesKey(data, Key.left) || data === "h";
    const confirm = matchesKey(data, Key.enter);
    const cancel = matchesKey(data, Key.escape) || data === "q";

    if (this.level === "list") {
      const agents = this.host.list();
      this.listIndex = Math.min(this.listIndex, Math.max(0, agents.length - 1));
      if (up || down) {
        const delta = up ? -1 : 1;
        if (agents.length > 0) {
          this.listIndex = (this.listIndex + delta + agents.length) % agents.length;
        }
      } else if (data === "x") {
        this.cancel(agents[this.listIndex]);
      } else if (confirm && agents.length > 0) {
        this.currentId = agents[this.listIndex].id;
        this.level = "agent";
        this.detailScroll = 0;
        this.promptExpanded = false;
      } else if (cancel) {
        this.close();
        return;
      }
      this.tui.requestRender();
      return;
    }

    const snapshot = this.current();
    if (!snapshot) {
      this.level = "list";
      this.tui.requestRender();
      return;
    }
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
    } else if (data === "x") {
      this.cancel(snapshot);
    } else if (cancel || left) {
      this.level = "list";
      const agents = this.host.list();
      const index = agents.findIndex((s) => s.id === this.currentId);
      if (index >= 0) this.listIndex = index;
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = dashboardHeight(this.tui);
    if (this.notice && Date.now() - this.noticeAt > NOTICE_TTL_MS) {
      this.notice = undefined;
    }
    const snapshot = this.level === "agent" ? this.current() : undefined;
    const lines = snapshot
      ? this.renderAgent(snapshot, width, height)
      : this.renderList(width, height);
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
    const agents = this.host.list();
    this.listIndex = Math.min(this.listIndex, Math.max(0, agents.length - 1));
    const working = agents.filter((s) => s.status === "working").length;

    const lines = [
      split(
        " " + theme.bold(theme.fg("accent", "Subagents")),
        theme.fg("dim", `${working} working · ${agents.length} total `),
        width,
      ),
      "",
    ];
    const panelHeight = Math.max(3, height - 3);
    const bodyHeight = Math.max(0, panelHeight - 2);

    if (agents.length === 0) {
      lines.push(
        ...panel(
          theme,
          "Agents",
          [theme.fg("dim", " no subagents this session")],
          width,
          panelHeight,
        ),
      );
      lines.push(this.hintLine("esc close", width));
      return lines;
    }

    const window = windowSlice(agents, this.listIndex, bodyHeight);
    const maxTitle = Math.min(
      32,
      Math.max(0, ...agents.map((s) => s.title.length)),
    );
    const rows: string[] = [];
    for (const [i, snapshot] of window.items.entries()) {
      const index = window.offset + i;
      const selected = index === this.listIndex;
      const marker = selected ? theme.fg("accent", "❯") : " ";
      const icon = theme.fg(
        statusColorKey(snapshot.status),
        statusIcon(snapshot.status),
      );
      const title = theme.fg(
        selected ? "accent" : "text",
        snapshot.title.padEnd(maxTitle),
      );
      const left = ` ${marker} ${icon} ${title}  ${theme.fg("dim", snapshotStats(snapshot))}`;
      const right =
        theme.fg("dim", `${elapsed(snapshot)} · `) +
        theme.fg(statusColorKey(snapshot.status), statusText(snapshot)) +
        " ";
      rows.push(split(left, right, width - 2));
      if (snapshot.status === "failed" && snapshot.errorText) {
        rows.push(
          truncateToWidth(`      ${theme.fg("error", snapshot.errorText)}`, width - 2, "…"),
        );
      }
    }
    lines.push(...panel(theme, "Agents", rows, width, panelHeight));
    lines.push(
      this.hintLine("↑↓ select · enter detail · x cancel · esc close", width),
    );
    return lines;
  }

  private renderAgent(
    snapshot: SubagentSnapshot,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const lines: string[] = [];

    const statParts = [
      snapshot.model ? shortModel(snapshot.model) : undefined,
      formatTokens(snapshot.tokens ?? undefined),
      snapshot.toolCalls > 0
        ? `${snapshot.toolCalls} tool${snapshot.toolCalls === 1 ? "" : "s"}`
        : undefined,
      elapsed(snapshot),
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(
      split(
        ` ${theme.fg(statusColorKey(snapshot.status), statusIcon(snapshot.status))} ${theme.bold(theme.fg("accent", snapshot.title))}` +
          `  ${theme.fg(statusColorKey(snapshot.status), statusText(snapshot))}`,
        theme.fg("dim", `${statParts} `),
        width,
      ),
    );
    const percent =
      snapshot.tokens !== null && snapshot.contextWindow
        ? ` · context ${Math.round((snapshot.tokens / snapshot.contextWindow) * 100)}% of ${Math.round(snapshot.contextWindow / 1000)}k`
        : "";
    const thinking = snapshot.thinking ? ` · thinking ${snapshot.thinking}` : "";
    lines.push(
      " " +
        theme.fg(
          "muted",
          `${snapshot.id} · ${snapshot.agentType} · run ${snapshot.runs}${thinking}${percent}`,
        ),
    );

    const panelHeight = Math.max(3, height - 3);
    const bodyHeight = Math.max(1, panelHeight - 2);
    const inner = Math.max(8, width - 4);

    // Body sections: Prompt, Activity, Report, Transcript.
    const rows: string[] = [];
    const preview = promptPreview(
      snapshot.prompt,
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
    const tail = snapshot.recentActivity.slice(-ACTIVITY_TAIL);
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
    rows.push(theme.bold(theme.fg("text", " Report")));
    if (snapshot.status === "working") {
      rows.push(theme.fg("dim", "   still working…"));
    } else if (snapshot.status === "failed" && snapshot.errorText) {
      for (const line of wrapTextWithAnsi(
        theme.fg("error", snapshot.errorText),
        inner,
      )) {
        rows.push(`   ${line}`);
      }
    }
    if (snapshot.finalText) {
      const reportLines = snapshot.finalText.split("\n").slice(0, REPORT_PREVIEW_LINES);
      for (const line of reportLines) {
        rows.push(`   ${theme.fg("text", truncateToWidth(line, inner, "…"))}`);
      }
      const total = snapshot.finalText.split("\n").length;
      if (total > reportLines.length) {
        rows.push(theme.fg("dim", `   … ${total - reportLines.length} more lines (subagent_check for the full report)`));
      }
    } else if (snapshot.status === "idle") {
      rows.push(theme.fg("dim", "   (no report text)"));
    }

    const transcript = this.host.transcriptTail(snapshot.id, TRANSCRIPT_TAIL);
    if (transcript.length > 0) {
      rows.push("");
      rows.push(theme.bold(theme.fg("text", " Transcript")));
      for (const line of transcript) {
        rows.push(`   ${theme.fg("muted", truncateToWidth(line, inner, "…"))}`);
      }
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

    const cancelHint = snapshot.status === "cancelled" ? "" : "x cancel · ";
    lines.push(
      this.hintLine(`↑↓ scroll · p prompt · ${cancelHint}esc back`, width),
    );
    return lines;
  }
}
