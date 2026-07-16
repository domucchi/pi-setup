# Extensions

Custom, self-written extensions only. This directory is symlinked to
`~/.pi/agent/extensions`, so pi auto-discovers every `*.ts` file and
`*/index.ts` directory here at startup; `/reload` hot-reloads while iterating.

Third-party extensions are NOT vendored here — install them with
`pi install npm:...` (tracked in machine-local `~/.pi/agent/settings.json`;
the canonical list lives in the top-level README so a new machine can replay
it). A vendor-everything policy was tried and abandoned: extensions importing
pi's API resolve modules through pi's own loader, and hand-vendored copies
fight it — see FRICTION.md 2026-07-16.

Extensions run with full system permissions. Review third-party source before
installing (clone the repo and read it, or have an agent sweep it — the
supply-chain review checklist from the dynamic-workflows vetting works well).
