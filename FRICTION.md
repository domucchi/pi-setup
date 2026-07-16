# Friction log

Observed friction from daily-driving pi. This list — not PLAN.md — decides
what gets built next. One line per item, date-prefixed; promote to a plan
phase when a pattern repeats.

- 2026-07-16: pi extensions that import `@earendil-works/pi-coding-agent`
  cannot load when pi is installed via vite-plus (`vp install -g`) — pi's
  loader truncates its package root at the first occurrence of the package
  name, and vite-plus's `pi-coding-agent#<uuid>` dir breaks that. Fixed by
  `vp uninstall -g` + `npm i -g @earendil-works/pi-coding-agent`. Worth
  reporting upstream (earendil-works/pi) — affects any vite-plus user.
- 2026-07-16: vendored extensions (source copied into the repo) hit the same
  loader problem from a different angle — pi's module aliasing overrides local
  node_modules. Policy reversed to `pi install` for third-party.

## Candidates already known

- 2026-07-16: only openai-codex is authed; Grok / Gemini / Anthropic-API keys
  needed before the multi-provider roster means anything (phase 3 prereq).
- 2026-07-16: no global system-prompt steering by design; if the same
  correction keeps recurring across projects, revisit via an agentic-setup
  render target rather than hand-written prompt files.
