/** Pure formatting for the footer + header (no pi/tui deps, unit-tested). */

/** Block "PI" logo (matches the Claude design). */
export const PI_LOGO = [
  "██████╗ ██╗",
  "██╔══██╗██║",
  "██████╔╝██║",
  "██╔═══╝ ██║",
  "██║     ██║",
  "╚═╝     ╚═╝",
];

export function formatCost(cost: number): string {
  return `$${(cost || 0).toFixed(3)}`;
}

export function formatTokensShort(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

/** "1.5% / 372k" — one decimal under 10%, whole numbers above. */
export function formatContext(percent: number | null, window: number): string {
  const pct =
    percent === null
      ? "?"
      : percent < 10
        ? percent.toFixed(1)
        : `${Math.round(percent)}`;
  const win = window > 0 ? formatTokensShort(window) : "?";
  return `${pct}% / ${win}`;
}

/** "provider/model" or just "model" / "no-model". */
export function formatModel(provider: string | undefined, id: string | undefined): string {
  const model = id || "no-model";
  return provider ? `${provider}/${model}` : model;
}
