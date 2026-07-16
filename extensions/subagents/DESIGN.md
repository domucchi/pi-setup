# subagents — design (settled 2026-07-16)

Decisions made with the user; build from this, don't relitigate.

## Execution model

- In-process pi SDK children via `createAgentSession()` — **pi backend only**
  (no claude/codex backends; revisit only on felt need).
- Real session files, so children are inspectable via `/resume`.
- Child resources loaded per cwd with trust gating (port
  `reference/my-pi-setup/extensions/shared/child-session.ts` semantics):
  same-cwd inherits live parent trust; other cwd only if the persisted
  ProjectTrustStore trusts it; fail closed on unreadable trust data.
- Per-tool timeout guard on children (~3 min via AbortSignal.any) and a
  first-response watchdog (~45s) so a stalled provider fails fast.
- Ephemeral: `session_shutdown` disposes everything. No resurrection in v1.

## Roles: markdown agent files (Claude Code style)

- Discovery: `~/.pi/agent/agents/*.md` (global) + `.pi/agents/*.md`
  (project, trust-gated). Project wins on name collision.
- Frontmatter: `name`, `description`, optional `tools` (allowlist),
  `model`, `thinking`. Body = system prompt appended to the child.
- Ship two starters:
  - `explore` — read-only scout: read, grep, find, ls, fd, rg. No bash.
  - `worker` — full toolset. Default when no agent_type given.
- `subagent_spawn` takes `agent_type` OR bare prompt (= worker).

## Communication: interactive (user chose the bigger build)

- Tools: `subagent_spawn`, `subagent_wait`, `subagent_check`,
  `subagent_cancel`, `subagent_list`, **`subagent_send`**.
- `subagent_send {id, message}`: steer if the child is streaming, else
  prompt a new turn. Works on settled children too — sessions stay alive
  (not disposed at settle) until session_shutdown, cancel, or LRU prune,
  so the parent can continue a finished child with context intact.
- Rationale: workflows will re-enter children (retry with feedback,
  self-verify); retrofitting steering later is worse than owning it now.

## Child tool policy: full minus denylist

- Children get read/bash/edit/write/grep/find/ls + fd/rg.
- Denylist (fresh array per call — shared mutable array becomes an
  accidental allowlist): `subagent_*`, `workflow`, `ask_user`, `bg_*`.
  bg_* excluded because a child's background processes die with it.
- Role files restrict further via `tools` allowlist.
- No security claim: children run bash as the user. Restrictions buy
  focus and blast radius, not safety. Worktree isolation = v2 flag.

## Results, caps, accounting

- Completion delivery: reuse the background-terminals pattern —
  deferred map, flush immediately when `ctx.isIdle()` else on
  `agent_settled`, `deliverAs: "followUp"` + `triggerTurn`; consumed by
  wait/check/cancel so nothing announces twice.
- MAX_RUNNING = 4, synchronous reservation before first await.
  MAX_TRACKED = 32 with LRU dispose of settled, non-awaited children.
- `subagent_wait` output budget ~48KB total / ~16KB per child.
- Context gauge from per-request usage, not cumulative aggregates
  (the reference documents the pins-at-100% bug twice).
- Normalized event union folded into one snapshot per child (needed for
  /subagents detail view and send()).

## UI (v1 minimal, real overlay later)

- Footer/widget: running count, like background-terminals.
- `/subagents`: picker (id, state, runtime, agent type, prompt head) →
  read-only detail with transcript tail, 1s refresh. Takeover/steer UI
  deferred to the ui-customization pass.

## Prompt/skill split

- prompt.ts: spawn semantics, self-contained-prompt rule ("child sees
  nothing of this conversation"), no-recursion/no-user-access, "keep
  working after spawn, wait only when results gate progress".
- skills/subagents/SKILL.md: the user's model roster + routing doctrine
  (which model/thinking per work shape). User-tunable without code.

## Deferred (v2+)

- Worktree isolation flag; claude/codex backends; structured output
  option; takeover UI; persistence across session switches.
- **Dispose-on-settle by default (opt-in keep_alive).** Today children
  stay alive after settling so subagent_send can resume them; only
  cancel/LRU/shutdown dispose them. Most spawns are fire-and-forget, so
  the better contract: dispose a child's session when it settles UNLESS
  the spawn set keep_alive/resumable, making subagent_send opt-in. Frees
  memory automatically (matters on a Pi) without relying on the model to
  cancel. Not urgent — LRU (MAX_TRACKED) already bounds growth and
  finished children don't hold MAX_WORKING slots. Self-destruct (child
  kills itself) is rejected: dismissal is a parent decision and races
  with follow-ups.
