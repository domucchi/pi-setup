---
name: subagents
description: Model routing and delegation doctrine for subagents. Load when spawning subagents to pick agent types, models, and thinking levels.
---

# Subagent routing doctrine

Mechanics (spawn/send/wait semantics, self-contained prompts, caps) are
in the tool descriptions. This file is the user's routing policy —
edit freely; it is read at load time, no code changes needed.

## Agent types

- `explore` — read-only scouting: locating code, mapping subsystems,
  answering "where/how does X work". Cheap to parallelize; prefer it
  whenever the task does not require edits.
- `worker` — full-tool execution: bounded implementation tasks with a
  runnable check ("fix X and run the tests", "apply this rename").
- `claude` — a real Claude Code instance (Anthropic models on the
  Claude subscription, full Claude Code toolset, permissions bypassed).
  Use when the work wants Claude's judgment/taste, or a second opinion
  from a different model family. Supports mid-run steering via
  subagent_send.
- `codex` — a real Codex instance (GPT models on the Codex
  subscription, shell/apply_patch/web-search, sandbox bypassed). Cheap
  abundant capacity for bulk or mechanical work. No mid-run steering —
  wait for settle, then send follow-ups.

## Backend routing

- Default `worker`/`explore` (pi backend): stays in-process, inherits
  the session model — right for most bounded tasks.
- Reach for `claude` when taste/judgment matters (user-facing text, API
  design, tricky reviews) or when Claude-only models are wanted —
  they are unavailable inside pi itself.
- Reach for `codex` for parallel bulk work where capacity beats nuance
  (sweeps, mechanical refactors, independent investigations).
- External children cannot see pi tools or this session; their prompts
  must be fully self-contained (same rule as always, more so).
- `model` on claude/codex spawns is passed through natively (e.g.
  "opus", "gpt-5.3-codex") — never pi provider/model ids.

## Model and thinking selection

Default: omit `model` — pi children inherit the parent session's model
and thinking level, which is usually right.

<!-- Roster: fill in as preferences emerge, e.g.
| Work shape                  | Agent type       | Thinking |
| --------------------------- | ---------------- | -------- |
| broad read-only scouting    | explore          | low      |
| implementation with checks  | worker           | medium+  |
| taste-sensitive review      | claude           | medium   |
| bulk mechanical sweeps      | codex            | low      |
-->

## Delegation rules

- One subagent = one bounded mission with a clear report format.
- Parallel fan-out: spawn several explores, keep working, wait once.
- Use subagent_send for retries with feedback ("your fix broke test Y —
  rerun and fix") instead of spawning fresh and losing context.
- After two failed rounds on the same child, take the work back.
