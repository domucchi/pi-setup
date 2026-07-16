# Extensions

This directory is symlinked to `~/.pi/agent/extensions`, so pi auto-discovers
every `*.ts` file and `*/index.ts` directory here at startup; `/reload`
hot-reloads while iterating.

## Policy: vendor everything

Every third-party extension is vendored here — including ones used as-is.
`pi install` / `pi update` are not used. Rationale:

- **Reproducible:** `pi install` state lives in machine-local `settings.json`
  and would never replicate across machines; vendored, clone + `install.sh` is
  the complete harness.
- **Review-before-update:** extensions run with full system permissions via
  jiti; `pi update` pulls upstream sight unseen. Vendored, every update is a
  git diff reviewed before it ever runs. Read every line before the first
  vendor too.

## UPSTREAM.md

Every vendored extension carries an `UPSTREAM.md` with machine-readable
key: value lines, so the update checker can diff against upstream:

```
repo: https://github.com/QuintinShaw/pi-dynamic-workflows
ref: main
commit: <sha vendored from>
path: .
```

`path` is the subdirectory within the upstream repo (`.` for repo root).

## Updates

`bin/check-updates.sh` (lands with the first vendored extension) reads each
`UPSTREAM.md`, compares the recorded commit against upstream via
`git ls-remote`, and reports what's behind; `--pull` copies the new upstream
source into the working tree and updates `UPSTREAM.md`, leaving the diff
uncommitted for review. Local modifications on top of upstream show up in that
diff — resolve, re-check `/reload`, then commit.

Extensions needing npm deps are a directory with `package.json`; run
`npm install` inside it (`node_modules/` is gitignored). If an upstream npm
package has a build step, run it at vendor time and note it in `UPSTREAM.md`.
