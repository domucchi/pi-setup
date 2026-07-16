import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Selector whose rows are recomputed every second, so durations and
 * statuses stay live (ctx.ui.select takes a one-shot string snapshot).
 * Resolves with the picked row index, or undefined on Esc.
 */
export function livePicker(
  ctx: ExtensionContext,
  title: string,
  rows: () => string[],
): Promise<number | undefined> {
  return ctx.ui.custom<number | undefined>((tui, theme, _keybindings, done) => {
    let index = 0;
    let settled = false;
    const finish = (result: number | undefined) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    const ticker = setInterval(() => tui.requestRender(), 1_000);

    return {
      render(width: number) {
        const items = rows();
        if (index >= items.length) index = Math.max(0, items.length - 1);
        const lines = [theme.fg("accent", theme.bold(` ${title}`)), ""];
        if (items.length === 0) {
          lines.push(theme.fg("muted", "  (none)"));
        }
        items.forEach((item, i) => {
          const selected = i === index;
          const prefix = selected ? theme.fg("accent", " ❯ ") : "   ";
          lines.push(
            truncateToWidth(
              prefix + (selected ? theme.fg("accent", item) : item),
              width,
            ),
          );
        });
        lines.push("");
        lines.push(
          truncateToWidth(
            theme.fg(
              "dim",
              ` ↑↓ or 1-${Math.min(items.length, 9)} select • Enter open • Esc close`,
            ),
            width,
          ),
        );
        return lines;
      },
      invalidate: () => {},
      handleInput(data: string) {
        if (matchesKey(data, Key.escape)) {
          finish(undefined);
          return;
        }
        const count = rows().length;
        if (count === 0) return;
        if (matchesKey(data, Key.up)) {
          index = (index - 1 + count) % count;
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.down)) {
          index = (index + 1) % count;
          tui.requestRender();
          return;
        }
        if (
          data.length === 1 &&
          data >= "1" &&
          data <= String(Math.min(count, 9))
        ) {
          finish(Number(data) - 1);
          return;
        }
        if (matchesKey(data, Key.enter)) {
          finish(Math.min(index, count - 1));
        }
      },
      dispose: () => clearInterval(ticker),
    };
  });
}
