# Extensions

This directory is symlinked to `~/.pi/agent/extensions`, so pi auto-discovers
every `*.ts` file and `*/index.ts` directory here at startup; `/reload`
hot-reloads while iterating.

## Policy

- **Vendor anything we modify.** Copy the source here and record its origin in
  the extension's `UPSTREAM.md` (repo URL + commit hash) so we can diff against
  upstream when pi's extension API changes.
- **`pi install npm:...` only for extensions used entirely as-is** (e.g.
  pi-dynamic-workflows). Those are tracked in `~/.pi/agent/settings.json`, not
  here, and update via `pi update`.
- Extensions run with full system permissions via jiti — read every line
  before loading anything third-party.
- Extensions needing npm deps are a directory with `package.json`; run
  `npm install` inside it (`node_modules/` is gitignored).
