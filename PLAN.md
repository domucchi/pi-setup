# Plan

Goal: a multi-model agent harness on pi that becomes a daily driver for real
work — Claude Code-quality subagents and workflows, any model calling any
model, with usage visibility. Experiments first, but every phase ends in
something used for actual work, with a runnable check.

## Principles

- **Adopt before build.** Use existing extensions; write from scratch only
  when nothing exists.
- **Third-party via `pi install`, custom in `extensions/`.** Review source
  before installing; the install list is replayed from README on new machines.
  (Vendor-everything was tried 2026-07-16 and abandoned — extensions importing
  pi's API only load reliably through pi's own package mechanism.)
- **Stay on the extension surface.** Never fork pi core. Pin the pi version
  within a phase; update deliberately and re-run checks after.
- **Anthropic models enter pi via API key only.** Claude subscription stays in
  Claude Code — the ToS risk of OAuth-in-third-party-harness is asymmetric
  (losing the Max account is not worth it).
- **Layering.** agentic-setup owns what agents know how to do (skills,
  doctrine); pi-setup owns how this harness runs.

## Phase 0 — scaffold (done)

Repo, installer with `--dry-run`/`--check`, symlinks into `~/.pi/agent`,
agentic-setup skills linked per-skill.

## Phase 1 — daily-drive baseline (in progress, 2026-07-16)

- [x] System prompt: keep pi's default untouched — steering lives in project
  `AGENTS.md` and skills, not a global append. (An APPEND_SYSTEM.md was tried
  and removed same day.)
- [x] Settings: `enabledModels` roster gpt-5.6-sol / terra / luna (all of
  today's authed providers); Sol at high thinking stays default. Grok /
  Gemini / Anthropic-API join the roster when keys land (phase 3 prereq).
- [x] Skills discovery verified live: all six agentic-setup skills listed by
  a real session (plus pre-existing `~/.agents/skills/` extras).
- [ ] Ctrl+P roster cycling — interactive, verify by hand.
- [ ] Exit: pi used for real work for ~a week, logging to `FRICTION.md` —
  that list, not this plan, drives what gets built next.

## Phase 2 — safety story

pi executes with full trust by default: no permission prompts, no sandbox.
Decide before subagents multiply the blast radius:

- permission-gate extension (adopt from pi's example extensions), and/or
- containerized runs (colima) for unattended / high-autonomy sessions.
- Exit: a written rule in this repo for what may run unsandboxed.

## Phase 3 — workflows + model routing (in progress, 2026-07-16)

- [x] Security review of pi-dynamic-workflows v2.14.0 @ 7800cbd (agent sweep:
  safe; treat the `workflow` tool as bash-equivalent trust; persisted runs
  auto-resume — whatever is in `~/.pi/workflows` runs).
- [x] Installed via `pi install npm:@quintinshaw/pi-dynamic-workflows`;
  verified loading (required reinstalling pi itself via npm — see FRICTION).
- [x] `~/.pi/workflows/model-tiers.json`: small=luna:low, medium=terra:medium,
  big=sol:high. xai (Grok) is authed too — swap into a tier when wanted.
- [ ] Exit: one real multi-agent workflow (e.g. adversarial review of an
  actual branch) run end-to-end with sensible cost.

## Phase 4 — dedicated subagents: NOT NEEDED (2026-07-16)

dynamic-workflows covers it: named agent types via `.pi/agents/*.md` (project)
and `~/.pi/agent/agents/*.md` (global) with per-agent model/tier routing, plus
scripted fan-out. Revisit only if interactive mid-run steering is missed.

## Phase 5 — usage telemetry

- Extension hook (or session-JSONL parser) → SQLite: tokens, cost, model,
  provider, session, per-day rollups.
- Revisit CLIProxyAPI only if cross-harness aggregation (Claude Code + Codex +
  pi in one funnel) becomes worth a third-party proxy holding OAuth tokens.

## Phase 6 — as needed

- MCP bridge extension for the few MCP-only tools with no CLI equivalent
  (default stance stays pi-style: CLI tools + READMEs).
- Headless orchestration: `pi -p` / `--mode rpc` for t3-code-style external
  session control.
- Fleet: pi on miku / asuka over SSH.

## Open questions

- `settings.json` is machine-local and pi mutates it; if config drift across
  machines gets annoying, add a versioned template rendered per machine
  (dotfiles pattern).
- Which agentic-setup skills actually earn their context in pi — prune after
  phase 1.
