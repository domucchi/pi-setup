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
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { runCommand } from "../shared/process.ts";
import { roundedBox } from "./src/box.ts";
import { gradientLogo } from "./src/gradient.ts";
import {
  formatContext,
  formatCost,
  formatModel,
  PI_LOGO,
} from "./src/format.ts";

const MARGIN = 1; // left/right gutter, matches outputPad
const TAGLINE = "agentic coding, in your terminal";
const SUBTAGLINE = "ask pi to explain its features or look up its own docs";

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

export default function uiCustomization(pi: ExtensionAPI) {
  let requestRender: (() => void) | undefined;
  let version = ""; // resolved async from `pi --version`

  const install = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;

    // ---- Header: bordered box with logo + version + folder + model ----
    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        invalidate() {},
        render(width: number) {
          const boxWidth = Math.max(24, width - MARGIN * 2);
          const model = ctx.model;
          const dir = formatDirectory(ctx.cwd);

          // Info column beside the logo.
          const info = [
            `${theme.fg("text", theme.bold("pi"))}  ${theme.fg("muted", TAGLINE)}`,
            theme.fg("dim", SUBTAGLINE),
            "",
            theme.fg("muted", dir),
            theme.fg("dim", formatModel(model?.provider, model?.id)),
          ];

          // Themed gradient logo (accent → borderAccent), flat fallback.
          const logo = gradientLogo(
            PI_LOGO,
            theme.getFgAnsi("accent"),
            theme.getFgAnsi("borderAccent"),
            theme.getColorMode() === "truecolor",
            (line) => theme.fg("accent", line),
          );

          // Zip the logo with the info column (info vertically centered).
          const offset = Math.max(0, Math.floor((PI_LOGO.length - info.length) / 2));
          const lines: string[] = [];
          for (let i = 0; i < PI_LOGO.length; i++) {
            const side = info[i - offset] ?? "";
            lines.push(`${logo[i]}     ${side}`);
          }
          const title = version ? `pi ${version}` : "pi";
          const boxed = roundedBox(
            title,
            lines,
            boxWidth,
            {
              border: (s) => theme.fg("border", s),
              title: (s) => theme.fg("accent", s),
            },
            3,
          );
          const pad = " ".repeat(MARGIN);
          return ["", ...boxed.map((l) => pad + l), ""];
        },
      };
    });

    // ---- Footer: single line — cost · context  ⟷  provider/model ● thinking.
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
            theme.fg("muted", formatCost(cost)) +
            theme.fg("dim", " (sub) · ") +
            theme.fg(
              "muted",
              formatContext(
                usage?.percent ?? null,
                usage?.contextWindow ?? model?.contextWindow ?? 0,
              ),
            );
          const right =
            theme.fg("dim", formatModel(model?.provider, model?.id)) +
            theme.fg("accent", " ● ") +
            theme.fg("muted", thinking);

          return [pad + columns(left, right, inner)];
        },
      };
    });

    ctx.ui.setTitle("pi");
  };

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
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
    }
  });
}
