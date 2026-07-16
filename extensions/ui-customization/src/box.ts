import { visibleWidth } from "@earendil-works/pi-tui";

export interface BoxTheme {
  border: (s: string) => string;
  title: (s: string) => string;
}

/**
 * Draw a rounded bordered box with an inset title in the top edge, like
 * Claude Code's header. `lines` are already color-formatted; padding is
 * computed on visible width so ANSI codes don't break alignment. `padX`
 * is the horizontal inner gutter; one blank row is added top and bottom.
 */
export function roundedBox(
  title: string,
  lines: string[],
  width: number,
  theme: BoxTheme,
  padX = 2,
): string[] {
  const w = Math.max(width, visibleWidth(title) + 8);
  const gutter = " ".repeat(padX);
  const content = w - 2 - padX * 2; // inside the borders and gutters

  const titleFill = Math.max(0, w - visibleWidth(title) - 5);
  const top =
    theme.border("╭─") +
    theme.title(` ${title} `) +
    theme.border("─".repeat(titleFill) + "╮");

  const padded = ["", ...lines, ""];
  const body = padded.map((line) => {
    const fill = Math.max(0, content - visibleWidth(line));
    return (
      theme.border("│") +
      gutter +
      line +
      " ".repeat(fill) +
      gutter +
      theme.border("│")
    );
  });

  const bottom = theme.border("╰" + "─".repeat(w - 2) + "╯");
  return [top, ...body, bottom];
}
