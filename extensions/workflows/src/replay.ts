import type { SandboxAgentOutcome } from "./sandbox.ts";

export interface ReplayKey {
  seq: number;
  promptHash: string;
  optsHash: string;
}

export interface ReplayEntry extends ReplayKey {
  outcome: SandboxAgentOutcome;
}

export type ReplayAttempt =
  | { hit: true; outcome: SandboxAgentOutcome }
  | { hit: false };

/**
 * Replay is prefix-only: calls are compared synchronously in deterministic
 * sandbox sequence. The first absent or mismatched entry closes replay for
 * the rest of the run, even if a later request would otherwise match.
 */
export function createPrefixReplayer(entries: readonly ReplayEntry[]) {
  let index = 0;
  let open = true;

  function tryReplay(key: ReplayKey): ReplayAttempt {
    if (!open) return { hit: false };
    const entry = entries[index];
    if (
      !entry ||
      entry.seq !== key.seq ||
      entry.promptHash !== key.promptHash ||
      entry.optsHash !== key.optsHash
    ) {
      open = false;
      return { hit: false };
    }
    index += 1;
    return { hit: true, outcome: entry.outcome };
  }

  return {
    tryReplay,
    isOpen: () => open,
    replayedCount: () => index,
  };
}
