/**
 * Real-binary resolution for external backends. `which` is unreliable
 * here: terminal multiplexers (cmux) prepend per-session shim
 * directories to PATH whose entries die with the multiplexer session.
 * Prefer well-known install locations, then PATH minus shim dirs.
 */

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function binaryCandidates(
  name: string,
  env: string | undefined = process.env.PATH,
): string[] {
  const home = homedir();
  const preferred = [
    path.join(home, ".local", "bin", name),
    "/opt/homebrew/bin/" + name,
    "/usr/local/bin/" + name,
    path.join(home, ".bun", "bin", name),
    path.join(home, ".npm-global", "bin", name),
  ];
  const fromPath = (env ?? "")
    .split(":")
    .filter((dir) => dir !== "" && !dir.includes("cmux-cli-shims"))
    .map((dir) => path.join(dir, name));
  return [...preferred, ...fromPath];
}

/** Absolute path of the first executable candidate, or undefined. */
export function findBinary(name: string): string | undefined {
  return binaryCandidates(name).find(executable);
}
