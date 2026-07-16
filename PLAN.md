# Plan

Goal: a multi-model agent harness on pi that becomes a daily driver for real
work — Claude Code-quality subagents and workflows, any model calling any
model, with usage visibility. Experiments first, but every phase ends in
something used for actual work, with a runnable check.

## Principles

- **Adopt before build.** Fork existing extensions; write from scratch only
  when nothing exists.
- **Vendor everything.** All third-party extensions live in `extensions/` with
  an `UPSTREAM.md`; `pi install`/`pi update` are not used. Updates arrive as
  reviewable diffs (see `extensions/README.md`).
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

- [x] Author `APPEND_SYSTEM.md` — five doctrine bullets, verified live (pi
  quoted the verification rule back in a `-p` session).
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

## Phase 3 — workflows + model routing

- Vendor QuintinShaw/pi-dynamic-workflows into `extensions/` (use as-is,
  `UPSTREAM.md` with commit).
- First vendored extension → write `bin/check-updates.sh` alongside it and
  verify it detects/pulls an upstream bump.
- Map `~/.pi/workflows/model-tiers.json` onto the routing table so
  orchestration effort levels pick the intended providers/models.
- Exit: one real multi-agent workflow (e.g. adversarial review of an actual
  branch) run end-to-end, cross-provider, with sensible cost.

## Phase 4 — dedicated subagents (only if still needed)

dynamic-workflows already spawns model-routed subagents; after phase 3,
evaluate whether interactive Claude Code-style delegation (named agent types,
mid-run steering) still has a gap.

- If yes: vendor-fork tintinweb/pi-subagents into `extensions/subagents/`
  (UPSTREAM.md with commit), add per-agent-type provider/model matrix
  (fable→sol, sol→grok, …).
- Exit: a cross-provider subagent completes a bounded real task with a
  runnable check.

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
