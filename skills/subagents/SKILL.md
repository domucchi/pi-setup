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
- `model` on claude/codex spawns is passed through natively (see the
  roster below) — never pi provider/model ids.

## Model roster (verified against the installed CLIs)

**claude backend** — pass an alias: `sonnet`, `opus`, or `fable`.
Omit for the Claude Code default. Never use `haiku`.

**codex backend** — pass a model id; `thinking` maps to codex
reasoning effort (minimal/low/medium/high accepted; xhigh/max exist
but require explicit user approval first — house rule):

| model id            | default effort | notes                          |
| ------------------- | -------------- | ------------------------------ |
| gpt-5.6-sol         | low            | frontier; hard problems        |
| gpt-5.6-terra       | medium         | workhorse                      |
| gpt-5.6-luna        | medium         | cheapest bulk capacity         |
| gpt-5.4-mini        | medium         | tiny/fast utility              |
| gpt-5.3-codex-spark | high           | code-specialized               |

(gpt-5.5 and gpt-5.4 also exist — superseded generations, no reason to
pick them.)

Routing by the user's ratings (capacity / intelligence / taste):
luna 10/5/4 · terra 9/7/5 · sol 6/9/6 · sonnet 5/7/7 · opus 4/8/8 ·
fable 2/10/10. Bulk → luna/terra. Hard reasoning → sol or opus.
User-facing taste → sonnet/opus/fable. Fable is scarce — reserve it
for judgment-critical work.

## Model and thinking selection

Default: omit `model` — pi children inherit the parent session's model
and thinking level; claude/codex children use their CLI defaults.

| Work shape                  | Agent type · model     | Thinking |
| --------------------------- | ---------------------- | -------- |
| broad read-only scouting    | explore                | low      |
| implementation with checks  | worker                 | medium+  |
| bulk mechanical sweeps      | codex · gpt-5.6-luna   | low      |
| independent hard analysis   | codex · gpt-5.6-sol    | high     |
| taste-sensitive review      | claude · sonnet/opus   | medium   |

## Delegation rules

- One subagent = one bounded mission with a clear report format.
- Parallel fan-out: spawn several explores, keep working, wait once.
- Use subagent_send for retries with feedback ("your fix broke test Y —
  rerun and fix") instead of spawning fresh and losing context.
- After two failed rounds on the same child, take the work back.
