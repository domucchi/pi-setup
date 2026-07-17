/**
 * ui-customization — a bordered startup header (Claude Code-style) and a
 * padded footer bar (cost · context · model), themed via the active pi
 * theme. Adapted from the Claude Design "Pi TUI" concept, fit to terminal
 * reality (no window chrome — the terminal is the window).
 *
 * Global breathing room comes from pi's own editorPaddingX / outputPad
 * settings (set in settings.json). This extension owns the header + footer;
 * both are indented to match that gutter.
 */

import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/agent-format.ts";
import { runCommand } from "../shared/process.ts";
import { gradientLogo } from "./src/gradient.ts";
import {
  formatContext,
  formatCost,
  formatModel,
  PI_MASCOT,
} from "./src/format.ts";

const MARGIN = 1; // left/right gutter, matches outputPad
const TAGLINE = "agentic coding, in your terminal";

function formatDirectory(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

function columns(left: string, right: string, width: number): string {
  if (!right) return truncateToWidth(left, width);
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`;
  const leftMax = Math.max(1, width - visibleWidth(right) - 1);
  const fitted = truncateToWidth(left, leftMax);
  const g = Math.max(1, width - visibleWidth(fitted) - visibleWidth(right));
  return truncateToWidth(`${fitted}${" ".repeat(g)}${right}`, width);
}

function sessionCost(ctx: ExtensionContext): number {
  let cost = 0;
  try {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        cost += entry.message.usage?.cost?.total ?? 0;
      }
    }
  } catch {
    // Session not ready yet.
  }
  return cost;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export default function uiCustomization(pi: ExtensionAPI) {
  let requestRender: (() => void) | undefined;
  let tuiRef: TUI | undefined;
  let version = ""; // resolved async from `pi --version`
  let stickyBottom = true;

  // ---- Suppress model/thinking chat statuses. pi appends them to the
  // chat on every cycle/switch, but both are already live in our footer;
  // in the chat they just pile up in scrollback. There is no core off
  // switch, and removing them after the fact flickers (they survive a
  // frame), so we wrap each container's addChild and swallow the status
  // BEFORE it ever renders — plus the blank spacer added just before it.
  // showStatus also has a fast path that MUTATES the previous status line
  // via setText instead of adding a new one, so Texts that pass through
  // the wrapper get their setText filtered too.
  const SUPPRESSED_STATUS = [
    /^Thinking level: \S+$/,
    /^Model: \S+$/,
    /^Switched to .+$/,
  ];
  const isSuppressedStatus = (text: string) =>
    SUPPRESSED_STATUS.some((pattern) => pattern.test(text));
  const FILTER_FLAG = "__piThinkingStatusFilter";
  const isBlank = (component: Component | undefined) => {
    const lines = component?.render?.(10);
    return (
      Array.isArray(lines) &&
      lines.every((l) => l.replace(ANSI_PATTERN, "").trim() === "")
    );
  };
  const installStatusFilter = () => {
    const tui = tuiRef;
    if (!tui) return;
    try {
      for (const child of tui.children) {
        const container = child as unknown as {
          children?: Component[];
          addChild?: ((c: Component) => void) & { [FILTER_FLAG]?: boolean };
          removeChild?: (c: Component) => void;
        };
        if (
          !Array.isArray(container.children) ||
          typeof container.addChild !== "function" ||
          typeof container.removeChild !== "function" ||
          container.addChild[FILTER_FLAG]
        ) {
          continue;
        }
        const original = container.addChild.bind(container);
        const wrapped = ((component: Component) => {
          try {
            const lines = component?.render?.(120);
            if (Array.isArray(lines)) {
              const text = lines.join("\n").replace(ANSI_PATTERN, "").trim();
              if (isSuppressedStatus(text)) {
                const last = container.children!.at(-1);
                if (last && isBlank(last)) container.removeChild!(last);
                return;
              }
            }
            // Guard the in-place mutation path: showStatus reuses the
            // previous status Text via setText when it is still last.
            const mutable = component as unknown as {
              setText?: ((value: string) => void) & { [FILTER_FLAG]?: boolean };
            };
            if (
              typeof mutable.setText === "function" &&
              !mutable.setText[FILTER_FLAG]
            ) {
              const originalSetText = mutable.setText.bind(component);
              const wrappedSetText = ((value: string) => {
                const stripped = value.replace(ANSI_PATTERN, "").trim();
                // Keep the previous text instead of showing the status.
                if (isSuppressedStatus(stripped)) return;
                originalSetText(value);
              }) as ((value: string) => void) & { [FILTER_FLAG]?: boolean };
              wrappedSetText[FILTER_FLAG] = true;
              mutable.setText = wrappedSetText;
            }
          } catch {
            // On any doubt, fall through to the normal add.
          }
          original(component);
        }) as ((c: Component) => void) & { [FILTER_FLAG]?: boolean };
        wrapped[FILTER_FLAG] = true;
        container.addChild = wrapped;
      }
    } catch {
      // Cosmetic filtering only — never break on pi internals shifting.
    }
  };

  // ---- Sticky input: pad the buffer so the editor hugs the terminal
  // bottom. pi-tui renders one linear buffer and shows its tail; on a
  // short session the editor would otherwise sit right under the content.
  // The filler measures every other component and pads the difference.
  // Cost: one extra logical render pass per frame (Text caches by width;
  // Markdown re-renders) — /sticky toggles it off if it ever drags.
  const installSticky = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    if (!stickyBottom) {
      ctx.ui.setWidget("sticky-bottom", undefined);
      return;
    }
    ctx.ui.setWidget(
      "sticky-bottom",
      (tui) => {
        // Walking tui.children re-enters this component (it lives in one of
        // those containers). The guard makes the nested call count as zero
        // height — identity checks are useless here because pi and the
        // extension resolve to different pi-tui copies (instanceof lies).
        let measuring = false;
        // The buffer must never shrink: pi's inline renderer can't unscroll,
        // so a shrinking buffer after a transient overflow (streaming tool
        // output that later collapses, autocomplete, status lines) forces
        // full redraws and duplicates content into scrollback. Pad to a
        // high-water mark instead — the filler absorbs collapses and is
        // consumed by new content before anything scrolls again.
        let highWater = 0;
        let lastWidth = 0;
        const filler: Component = {
          invalidate() {},
          render(width: number) {
            if (measuring) return [];
            measuring = true;
            try {
              if (width !== lastWidth) {
                // Rewrap changes every height; start the mark over.
                lastWidth = width;
                highWater = 0;
              }
              let total = 0;
              for (const child of tui.children) {
                total += child.render(width).length;
              }
              highWater = Math.max(highWater, tui.terminal.rows, total);
              return Array.from(
                { length: Math.max(0, highWater - total) },
                () => "",
              );
            } catch {
              // Measurement is best-effort; never break the frame.
              return [];
            } finally {
              measuring = false;
            }
          },
        };
        return filler;
      },
      { placement: "aboveEditor" },
    );
  };

  const install = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    installSticky(ctx);

    // ---- Header: minimal, Claude Code-style — small gradient mascot
    // beside name/version, tagline, cwd. No box, and deliberately NO
    // model line: the header freezes into scrollback, so anything that
    // can change mid-session (model, thinking) would go stale there.
    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      tuiRef = tui;
      return {
        invalidate() {},
        render(width: number) {
          const info = [
            theme.fg("text", theme.bold("pi")) +
              (version ? theme.fg("dim", ` v${version}`) : ""),
            theme.fg("muted", TAGLINE),
            theme.fg("dim", formatDirectory(ctx.cwd)),
          ];

          // Themed gradient mascot (accent → borderAccent), flat fallback.
          const logo = gradientLogo(
            PI_MASCOT,
            theme.getFgAnsi("accent"),
            theme.getFgAnsi("borderAccent"),
            theme.getColorMode() === "truecolor",
            (line) => theme.fg("accent", line),
          );

          const pad = " ".repeat(MARGIN);
          const lines: string[] = [];
          for (let i = 0; i < PI_MASCOT.length; i++) {
            const side = info[i] ?? "";
            lines.push(
              truncateToWidth(`${pad}${logo[i]}   ${side}`, width),
            );
          }
          return ["", ...lines, ""];
        },
      };
    });

    // ---- Footer: single line — provider/model ● thinking  ⟷  cost · context.
    // Git lives in a widget above the input (git-info); other extension
    // statuses (e.g. MCP) are intentionally not shown here.
    ctx.ui.setFooter((tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        invalidate() {},
        render(width: number) {
          const inner = Math.max(8, width - MARGIN * 2);
          const pad = " ".repeat(MARGIN);
          const cost = sessionCost(ctx);
          const usage = ctx.getContextUsage();
          const model = ctx.model;
          const thinking = model?.reasoning ? pi.getThinkingLevel() : "off";

          const left =
            theme.fg("dim", model?.name + " (" + formatModel(model?.provider, model?.id) + ")") +
            " " +
            theme.fg("muted", thinking);
          const right =
            theme.fg("muted", formatCost(cost)) +
            theme.fg("dim", " (sub) · ") +
            theme.fg(
              "muted",
              formatContext(
                usage?.percent ?? null,
                usage?.contextWindow ?? model?.contextWindow ?? 0,
              ),
            );

          return [pad + columns(left, right, inner)];
        },
      };
    });

    // Terminal title is owned by pi core ("π - {session name} - {folder}");
    // the session-title extension names sessions via appendSessionInfo.
    // setHeader above captured tuiRef synchronously; safe to patch now.
    installStatusFilter();
  };

  // ---- Working timer: the built-in loader says just "Working..." —
  // tick the elapsed time into it, and when the run settles leave a
  // small dim line with the total. The line is a custom ENTRY (not a
  // message), so it renders in the chat and persists in the session
  // without ever entering the model's context.
  const WORK_ENTRY_TYPE = "worked-for";
  let workStartedAt: number | undefined;
  let workTicker: ReturnType<typeof setInterval> | undefined;

  pi.registerEntryRenderer<{ ms: number }>(WORK_ENTRY_TYPE, (entry, _options, theme) => {
    return new Text(
      theme.fg("dim", `Worked for ${formatDuration(entry.data?.ms ?? 0)}`),
      1,
      0,
    );
  });

  const stopWorkTicker = () => {
    if (workTicker) clearInterval(workTicker);
    workTicker = undefined;
  };

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    workStartedAt = Date.now();
    const update = () => {
      if (workStartedAt === undefined) return;
      ctx.ui.setWorkingMessage(
        `Working... ${formatDuration(Date.now() - workStartedAt)} · esc to interrupt`,
      );
    };
    update();
    stopWorkTicker();
    workTicker = setInterval(update, 1_000);
    workTicker.unref?.();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (workStartedAt === undefined) return;
    const ms = Date.now() - workStartedAt;
    workStartedAt = undefined;
    stopWorkTicker();
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingMessage();
    pi.appendEntry(WORK_ENTRY_TYPE, { ms });
  });

  pi.registerCommand("sticky", {
    description: "Toggle the input sticking to the terminal bottom",
    handler: async (_args, ctx) => {
      stickyBottom = !stickyBottom;
      installSticky(ctx);
      ctx.ui.notify(`sticky input ${stickyBottom ? "on" : "off"}`, "info");
    },
  });

  const nudge = () => requestRender?.();

  pi.on("session_start", (_event, ctx) => {
    install(ctx);
    if (!version) {
      // Resolve the running pi version once for the header title.
      void runCommand("pi", ["--version"], ctx.cwd, 5_000).then((r) => {
        if (r.code === 0) {
          version = r.stdout.trim().split(/\s+/).pop() ?? "";
          nudge();
        }
      });
    }
  });
  pi.on("turn_end", nudge);
  pi.on("message_end", nudge);
  pi.on("tool_execution_end", nudge);
  pi.on("agent_settled", nudge);
  pi.on("model_select", nudge);
  pi.on("thinking_level_select", nudge);

  pi.on("session_shutdown", (_event, ctx) => {
    requestRender = undefined;
    tuiRef = undefined;
    workStartedAt = undefined;
    stopWorkTicker();
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget("sticky-bottom", undefined);
    }
  });
}
