/**
 * Pure formatting shared by the subagents and workflows dashboards
 * (no pi/tui deps, unit-tested).
 */

/** "842 tok", "12.3k tok", "142k tok". */
export function formatTokens(tokens: number | undefined): string | undefined {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) {
    return undefined;
  }
  if (tokens < 1_000) return `${Math.round(tokens)} tok`;
  const k = tokens / 1_000;
  if (k >= 100) return `${Math.round(k)}k tok`;
  return `${k.toFixed(1).replace(/\.0$/, "")}k tok`;
}

/** "44s", "5m37s", "12m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1_000))}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
}

/** Bare model id without the provider prefix, for compact rows. */
export function shortModel(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(slash + 1) : model;
}

export interface PromptPreview {
  lines: string[];
  totalLines: number;
  clipped: boolean;
}

/** First maxLines of a prompt (0 = everything), with clipping info. */
export function promptPreview(
  prompt: string | undefined,
  maxLines: number,
): PromptPreview {
  const all = (prompt ?? "").split("\n");
  if (all.length === 1 && all[0] === "") {
    return { lines: [], totalLines: 0, clipped: false };
  }
  if (maxLines <= 0 || all.length <= maxLines) {
    return { lines: all, totalLines: all.length, clipped: false };
  }
  return { lines: all.slice(0, maxLines), totalLines: all.length, clipped: true };
}

/** Scroll window that keeps `selected` visible, centered where possible. */
export function windowSlice<T>(
  items: T[],
  selected: number,
  size: number,
): { items: T[]; offset: number } {
  if (size <= 0) return { items: [], offset: 0 };
  if (items.length <= size) return { items, offset: 0 };
  const offset = Math.max(
    0,
    Math.min(selected - Math.floor(size / 2), items.length - size),
  );
  return { items: items.slice(offset, offset + size), offset };
}

/**
 * Stable sort putting running items first, each group ordered by
 * startedAt descending (most recent first). Running work is what the
 * user acts on, so it belongs at the top of every agent/run list.
 */
export function sortRunningFirst<T>(
  items: T[],
  isRunning: (item: T) => boolean,
  startedAt: (item: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const ar = isRunning(a) ? 1 : 0;
    const br = isRunning(b) ? 1 : 0;
    if (ar !== br) return br - ar; // running group first
    return startedAt(b) - startedAt(a); // then most recent
  });
}
