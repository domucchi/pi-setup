import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Read-only detail view: renders `lines()` fresh every second (live
 * durations, statuses, tails). Esc / Enter / q resolves back to the
 * caller — pair with livePicker for a picker → detail → back loop.
 */
export function liveDetailView(
  ctx: ExtensionContext,
  lines: () => string[],
): Promise<void> {
  return ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const ticker = setInterval(() => tui.requestRender(), 1_000);
    return {
      render(width: number) {
        const out = lines().map((line) => truncateToWidth(` ${line}`, width));
        out.push("");
        out.push(truncateToWidth(theme.fg("dim", " Esc back to list"), width));
        return out;
      },
      invalidate: () => {},
      handleInput(data: string) {
        if (
          matchesKey(data, Key.escape) ||
          matchesKey(data, Key.enter) ||
          data === "q"
        ) {
          done(undefined);
        }
      },
      dispose: () => clearInterval(ticker),
    };
  });
}
