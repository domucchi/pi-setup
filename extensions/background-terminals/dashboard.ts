/**
 * /ps dashboard: a two-level overlay matching the subagents/workflows
 * ones.
 *
 *   Level 1 — terminal list:
 *   Background terminals                             1 running · 3 total
 *   ╭ Terminals ────────────────────────────────────────────────────╮
 *   │ ❯ ● dev server    bg-1 · $ npm run dev            3m12s · running │
 *   │   ✓ typecheck     bg-2 · $ tsc --noEmit              41s · done │
 *   ╰────────────────────────────────────────────────────────────────╯
 *
 *   Level 2 — terminal detail: command/cwd, stdout+stderr tails (live,
 *   scrollable), spill log paths. x kills the process (SIGTERM→SIGKILL).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import { windowSlice } from "../shared/agent-format.ts";
import {
  dashboardHeight,
  panel,
  split,
  type OverlayTheme,
} from "../shared/overlay.ts";
import { describeDuration, describeOutcome, lastLines } from "./prompt.ts";
import type { TerminalEntry, TerminalStatus } from "./src/manager.ts";

const STDOUT_TAIL_LINES = 40;
const STDERR_TAIL_LINES = 10;
const NOTICE_TTL_MS = 3_000;

export interface TerminalsHost {
  list(): TerminalEntry[];
  /** Request a kill (fire-and-forget; the list will reflect it). */
  kill(id: string): void;
}

export function showTerminalsDashboard(
  ctx: ExtensionContext,
  host: TerminalsHost,
): Promise<void> {
  return ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const dashboard = new TerminalsDashboard(tui, theme, host, () => {
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

export function statusIcon(status: TerminalStatus): string {
  switch (status) {
    case "running":
      return "◆";
    case "done":
      return "✓";
    case "failed":
      return "✗";
    case "killed":
      return "·";
  }
}

export function statusColorKey(
  status: TerminalStatus,
): "warning" | "success" | "error" | "muted" {
  switch (status) {
    case "running":
      return "warning";
    case "done":
      return "success";
    case "failed":
      return "error";
    case "killed":
      return "muted";
  }
}

type Level = "list" | "detail";

class TerminalsDashboard {
  private level: Level = "list";
  private listIndex = 0;
  private currentId?: string;
  private detailScroll = 0;
  private detailRowCount = 0;
  private detailViewport = 1;
  private notice?: string;
  private noticeAt = 0;
  private disposed = false;
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    private readonly theme: OverlayTheme,
    private readonly host: TerminalsHost,
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

  private current(): TerminalEntry | undefined {
    return this.host.list().find((e) => e.id === this.currentId);
  }

  private setNotice(text: string) {
    this.notice = text;
    this.noticeAt = Date.now();
  }

  private kill(entry: TerminalEntry | undefined) {
    if (!entry) return;
    if (entry.status !== "running") {
      this.setNotice(`${entry.id} is not running`);
      return;
    }
    this.host.kill(entry.id);
    this.setNotice(`killing ${entry.id}…`);
  }

  handleInput(data: string) {
    const up = matchesKey(data, Key.up) || data === "k";
    const down = matchesKey(data, Key.down) || data === "j";
    const left = matchesKey(data, Key.left) || data === "h";
    const confirm = matchesKey(data, Key.enter);
    const cancel = matchesKey(data, Key.escape) || data === "q";

    if (this.level === "list") {
      const entries = this.host.list();
      this.listIndex = Math.min(this.listIndex, Math.max(0, entries.length - 1));
      if (up || down) {
        const delta = up ? -1 : 1;
        if (entries.length > 0) {
          this.listIndex =
            (this.listIndex + delta + entries.length) % entries.length;
        }
      } else if (data === "x") {
        this.kill(entries[this.listIndex]);
      } else if (confirm && entries.length > 0) {
        this.currentId = entries[this.listIndex].id;
        this.level = "detail";
        this.detailScroll = 0;
      } else if (cancel) {
        this.close();
        return;
      }
      this.tui.requestRender();
      return;
    }

    const entry = this.current();
    if (!entry) {
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
    } else if (data === "x") {
      this.kill(entry);
    } else if (cancel || left) {
      this.level = "list";
      const entries = this.host.list();
      const index = entries.findIndex((e) => e.id === this.currentId);
      if (index >= 0) this.listIndex = index;
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = dashboardHeight(this.tui);
    if (this.notice && Date.now() - this.noticeAt > NOTICE_TTL_MS) {
      this.notice = undefined;
    }
    const entry = this.level === "detail" ? this.current() : undefined;
    const lines = entry
      ? this.renderDetail(entry, width, height)
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
    const entries = this.host.list();
    this.listIndex = Math.min(this.listIndex, Math.max(0, entries.length - 1));
    const running = entries.filter((e) => e.status === "running").length;

    const lines = [
      split(
        " " + theme.bold(theme.fg("accent", "Background terminals")),
        theme.fg("dim", `${running} running · ${entries.length} total `),
        width,
      ),
      "",
    ];
    const panelHeight = Math.max(3, height - 3);
    const bodyHeight = Math.max(0, panelHeight - 2);

    if (entries.length === 0) {
      lines.push(
        ...panel(
          theme,
          "Terminals",
          [theme.fg("dim", " no background terminals this session")],
          width,
          panelHeight,
        ),
      );
      lines.push(this.hintLine("esc close", width));
      return lines;
    }

    const window = windowSlice(entries, this.listIndex, bodyHeight);
    const maxTitle = Math.min(
      28,
      Math.max(0, ...entries.map((e) => e.title.length)),
    );
    const rows: string[] = [];
    let dividerDrawn = false;
    for (const [i, entry] of window.items.entries()) {
      const index = window.offset + i;
      // Thin divider where the running block ends (list is running-first).
      if (
        !dividerDrawn &&
        entry.status !== "running" &&
        index > 0 &&
        entries[index - 1]?.status === "running"
      ) {
        rows.push(theme.fg("borderMuted", ` ${"─".repeat(Math.max(0, width - 4))}`));
        dividerDrawn = true;
      }
      const selected = index === this.listIndex;
      const marker = selected ? theme.fg("accent", "❯") : " ";
      const icon = theme.fg(statusColorKey(entry.status), statusIcon(entry.status));
      const title = theme.fg(
        selected ? "accent" : "text",
        entry.title.padEnd(maxTitle),
      );
      const command = entry.command.replace(/\s+/g, " ").slice(0, 60);
      const left = ` ${marker} ${icon} ${title}  ${theme.fg("dim", `${entry.id} · $ ${command}`)}`;
      const right =
        theme.fg("dim", `${describeDuration(entry.startedAt, entry.settledAt)} · `) +
        theme.fg(statusColorKey(entry.status), entry.status) +
        " ";
      rows.push(split(left, right, width - 2));
    }
    lines.push(...panel(theme, "Terminals", rows, width, panelHeight));
    lines.push(
      this.hintLine("↑↓ select · enter detail · x kill · esc close", width),
    );
    return lines;
  }

  private renderDetail(
    entry: TerminalEntry,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const lines: string[] = [];

    lines.push(
      split(
        ` ${theme.fg(statusColorKey(entry.status), statusIcon(entry.status))} ${theme.bold(theme.fg("accent", entry.title))}` +
          `  ${theme.fg(statusColorKey(entry.status), describeOutcome(entry))}`,
        theme.fg(
          "dim",
          `${describeDuration(entry.startedAt, entry.settledAt)} `,
        ),
        width,
      ),
    );
    lines.push(" " + theme.fg("muted", `${entry.id} · ${entry.cwd}`));

    const panelHeight = Math.max(3, height - 3);
    const bodyHeight = Math.max(1, panelHeight - 2);
    const inner = Math.max(8, width - 4);

    const rows: string[] = [];
    rows.push(theme.fg("accent", " $ ") + theme.fg("text", entry.command));
    rows.push("");

    const stdout = lastLines(entry.stdout.text(), STDOUT_TAIL_LINES);
    rows.push(
      theme.bold(theme.fg("text", " stdout")) +
        theme.fg("dim", stdout.length > 0 ? ` · last ${stdout.length} lines` : ""),
    );
    if (stdout.length === 0) rows.push(theme.fg("dim", "   (empty)"));
    for (const line of stdout) {
      rows.push(`   ${theme.fg("toolOutput", truncateToWidth(line, inner, "…"))}`);
    }

    const stderr = lastLines(entry.stderr.text(), STDERR_TAIL_LINES);
    if (stderr.length > 0) {
      rows.push("");
      rows.push(
        theme.bold(theme.fg("text", " stderr")) +
          theme.fg("dim", ` · last ${stderr.length} lines`),
      );
      for (const line of stderr) {
        rows.push(`   ${theme.fg("error", truncateToWidth(line, inner, "…"))}`);
      }
    }

    if (entry.spill) {
      rows.push("");
      rows.push(theme.fg("dim", ` logs: ${entry.spill.stdoutPath}`));
      rows.push(theme.fg("dim", `       ${entry.spill.stderrPath}`));
    }

    this.detailRowCount = rows.length;
    this.detailViewport = bodyHeight;
    const maxScroll = Math.max(0, rows.length - bodyHeight);
    // Follow live output: while running and unscrolled, pin to the tail.
    if (entry.status === "running" && this.detailScroll >= maxScroll - 1) {
      this.detailScroll = maxScroll;
    }
    this.detailScroll = Math.min(this.detailScroll, maxScroll);
    const visible = rows.slice(this.detailScroll, this.detailScroll + bodyHeight);
    const title =
      rows.length > bodyHeight
        ? `Terminal · ${this.detailScroll + 1}-${Math.min(rows.length, this.detailScroll + bodyHeight)}/${rows.length}`
        : "Terminal";
    lines.push(...panel(theme, title, visible, width, panelHeight));

    const killHint = entry.status === "running" ? "x kill · " : "";
    lines.push(this.hintLine(`↑↓ scroll · ${killHint}esc back`, width));
    return lines;
  }
}
