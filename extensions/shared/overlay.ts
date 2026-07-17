/**
 * Shared building blocks for full-screen overlay dashboards
 * (/workflows, /subagents): bordered panels with titled borders,
 * left…right split rows, and overlay sizing.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

/** The theme handed to ctx.ui.custom factories. */
export type OverlayTheme = Parameters<
  Parameters<ExtensionContext["ui"]["custom"]>[0]
>[1];

export const MIN_OVERLAY_HEIGHT = 12;
const FALLBACK_INPUT_CHROME = 6;

/**
 * Rows available to a top-anchored dashboard overlay: the full terminal
 * minus the input area. pi's last three components are the editor
 * container, the below-editor widgets, and the footer — measure them so
 * the overlay stops exactly where the prompt begins.
 */
export function dashboardHeight(tui: TUI): number {
  let chrome = FALLBACK_INPUT_CHROME;
  try {
    const width = tui.terminal.columns;
    chrome = tui.children
      .slice(-3)
      .reduce((sum, child) => sum + child.render(width).length, 0);
  } catch {
    // Keep the fallback; a slightly-short overlay beats a broken frame.
  }
  return Math.max(MIN_OVERLAY_HEIGHT, tui.terminal.rows - chrome);
}

/** Compose `left … right` within width, truncating the left side. */
export function split(left: string, right: string, width: number): string {
  const rightWidth = visibleWidth(right);
  let text = left;
  if (visibleWidth(text) + rightWidth + 1 > width) {
    text = truncateToWidth(text, Math.max(0, width - rightWidth - 2), "…");
  }
  const pad = Math.max(1, width - visibleWidth(text) - rightWidth);
  return text + " ".repeat(pad) + right;
}

/** Bordered panel with the title in the top border, padded to exact height. */
export function panel(
  theme: OverlayTheme,
  title: string,
  rows: string[],
  width: number,
  height: number,
): string[] {
  const inner = Math.max(0, width - 2);
  const border = (s: string) => theme.fg("borderMuted", s);
  const titleText = truncateToWidth(` ${title} `, Math.max(0, inner - 2), "…");
  const dashes = Math.max(0, inner - visibleWidth(titleText) - 1);
  const lines: string[] = [
    border("╭─") + theme.fg("muted", titleText) + border(`${"─".repeat(dashes)}╮`),
  ];
  const bodyHeight = Math.max(0, height - 2);
  for (let i = 0; i < bodyHeight; i++) {
    const row = rows[i] ?? "";
    const clipped = truncateToWidth(row, inner, "…");
    const pad = Math.max(0, inner - visibleWidth(clipped));
    lines.push(border("│") + clipped + " ".repeat(pad) + border("│"));
  }
  lines.push(border(`╰${"─".repeat(inner)}╯`));
  return lines;
}
