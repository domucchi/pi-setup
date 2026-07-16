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

## Model and thinking selection

Default: omit `model` — children inherit the parent session's model and
thinking level, which is usually right.

<!-- Roster: fill in as preferences emerge, e.g.
| Work shape                  | Model            | Thinking |
| --------------------------- | ---------------- | -------- |
| broad read-only scouting    | (cheaper model)  | low      |
| implementation with checks  | (parent default) | medium+  |
-->

## Delegation rules

- One subagent = one bounded mission with a clear report format.
- Parallel fan-out: spawn several explores, keep working, wait once.
- Use subagent_send for retries with feedback ("your fix broke test Y —
  rerun and fix") instead of spawning fresh and losing context.
- After two failed rounds on the same child, take the work back.
