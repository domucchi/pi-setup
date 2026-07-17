/** Snapshot capping + spill (pure logic testable; spill uses fs). */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

export const SNAPSHOT_MAX_CHARS = 40_000;

let spillCounter = 0;

/** Write the full snapshot to an owner-only temp file; returns its path. */
export function spillSnapshot(full: string): string {
  const dir = path.join(tmpdir(), "pi-browser", `pid-${process.pid}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  spillCounter += 1;
  const file = path.join(dir, `snapshot-${spillCounter}.txt`);
  writeFileSync(file, full, { mode: 0o600 });
  return file;
}

export interface CappedSnapshot {
  text: string;
  truncated: boolean;
  totalChars: number;
}

/** Cap a snapshot at maxChars on a line boundary. */
export function capSnapshot(
  full: string,
  maxChars = SNAPSHOT_MAX_CHARS,
): CappedSnapshot {
  if (full.length <= maxChars) {
    return { text: full, truncated: false, totalChars: full.length };
  }
  const cut = full.slice(0, maxChars);
  const lastNewline = cut.lastIndexOf("\n");
  return {
    text: lastNewline > maxChars / 2 ? cut.slice(0, lastNewline) : cut,
    truncated: true,
    totalChars: full.length,
  };
}

/** Capped snapshot text plus a truncation notice with the spill path. */
export function presentSnapshot(
  full: string,
  spill: (full: string) => string = spillSnapshot,
): string {
  const capped = capSnapshot(full);
  if (!capped.truncated) return capped.text;
  const file = spill(full);
  return `${capped.text}\n\n[snapshot capped at ${capped.text.length} of ${capped.totalChars} chars — full snapshot saved to ${file}]`;
}
