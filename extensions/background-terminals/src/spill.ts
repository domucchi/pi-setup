import { createWriteStream, mkdirSync, rmSync, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

export interface SpillTarget {
  dir: string;
  stdoutPath: string;
  stderrPath: string;
  stdout: WriteStream;
  stderr: WriteStream;
}

/**
 * Full, unbounded output capture on disk (owner-only), so the model can
 * read or grep complete output even after the in-memory ring truncated.
 * One directory per pi process, one file pair per terminal.
 */
export function sessionSpillRoot() {
  return path.join(tmpdir(), "pi-background-terminals", `pid-${process.pid}`);
}

export function createSpillTarget(id: string): SpillTarget {
  const dir = sessionSpillRoot();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stdoutPath = path.join(dir, `${id}.stdout.log`);
  const stderrPath = path.join(dir, `${id}.stderr.log`);
  return {
    dir,
    stdoutPath,
    stderrPath,
    stdout: createWriteStream(stdoutPath, { mode: 0o600 }),
    stderr: createWriteStream(stderrPath, { mode: 0o600 }),
  };
}

export function removeSpillRoot() {
  rmSync(sessionSpillRoot(), { recursive: true, force: true });
}
