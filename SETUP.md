# Setup

This repo becomes the contents of `~/.pi/agent` via symlinks, so edits
here take effect the next time pi starts — no copy step, and the harness
stays versioned in git.

## Install

```sh
./install.sh
```

This installs npm dependencies and symlinks `extensions/`, `agents/`,
`skills/`, `AGENTS.md`, and `node_modules/` into `~/.pi/agent`
(overriding the target with `PI_AGENT_DIR`). It is idempotent and skips
any target that already exists as a real file.

## External tools

- **fd** and **rg** — required by the file-search extension
  (`brew install fd ripgrep`, or your package manager). The extension
  fails a call with an install hint if either is missing.
- **gh** — optional; git-info uses it for PR lookups and silently skips
  them when absent.

## Extensions run under Node

pi loads extensions in-process via jiti, so they run under whatever
runtime launched pi (Node here). No build step — pi executes the
TypeScript directly.

## Development

- `npm test` — vitest (pure-logic modules, the sandbox, arg builders).
- `npm run check` — `tsc --noEmit`.

The sandbox tests spawn real `--permission` Node child processes, so
they exercise the actual isolation boundary.
