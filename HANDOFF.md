# Handoff — pi harness UI work

## State (2026-07-17)

Functionally complete harness. All extensions built, tested, committed:
git-info, ask-user, background-terminals, file-search, subagents,
workflows, web-access, ui-customization. MCP via installed
pi-mcp-adapter. 152 vitest tests, tsc clean. See `PLAN.md` for
architecture/decisions; `README.md`/`SETUP.md` for the map.

**UI pass done and committed** (`b66b947`): rose-pine (default) +
catppuccin-mocha themes; `ui-customization` extension = bordered startup
header box with a themed gradient PI logo + single-line footer
(cost · context ⟷ model ● thinking); git-info shows branch/dirty/PR as a
right-aligned widget above the input; `/workflows` junk (other sessions'
runs) fixed.

### User-local settings NOT in the repo (in `~/.pi/agent/settings.json`)

`theme: "rose-pine"`, `editorPaddingX: 2`, `outputPad: 1`. These give the
"breathing room". Documented in SETUP.md; re-set them if testing on a
fresh machine. Themes/extensions/agents/skills are symlinked in by
`install.sh`.

## NEXT TASK: rich subagents + workflows views

The user wants Claude Code-style subagent/workflow UX (they shared
screenshots — see the conversation). Two parts:

### 1. Backend data expansion (do first — the views need it)

Current per-agent tracking is thin. `extensions/workflows/index.ts`
`ActiveAgent` has only seq/label/phase/state/error/durationMs.
`extensions/subagents/src/manager.ts` `SubagentSnapshot` is richer
(model, tokens, contextWindow, lastActivity) — mirror that for workflow
agents. Plumb from the child (`extensions/subagents/src/child.ts` already
exposes modelLabel, usage(), and emits `activity` events with tool
previews) through the workflow runner
(`extensions/workflows/src/runner.ts` — add these to `RunnerEvent`) into
`ActiveAgent`: model, tokens, tool-call count, recent tool activity, and
the agent's prompt (available in the runner's request).

### 2. The views (ctx.ui.custom components, themed)

Target (from the user's screenshots):
- **Under the input**: active subagents/workflows indicator (we already
  set widgets: subagents `◆ N working`, workflows `▸ workflow…`). Make it
  read like Claude's `← N agents · ↓ to manage`. True `↓`-to-open is
  nice-to-have (pi has registerShortcut, but ↓ conflicts with the
  editor); the `/subagents` `/workflows` commands are the entry today.
- **Workflow detail = three-level two-pane**: left `Phases` list (title +
  done/total, current marked) │ right = agents in the selected phase │
  Enter on an agent → agent detail (Running · model, tok · N tool calls,
  Prompt · N lines · expand, Activity · last 3 tool calls, Outcome).
  Store `meta.phases` on `ActiveRun` (not currently kept). Footer hints:
  `↑↓ select · x stop · esc back`.
- **Subagent view**: closer to done (livePicker + liveDetailView in
  `extensions/subagents/index.ts`). Enrich the detail with model/tokens/
  activity. Jumping into the child's live session is explicitly DEFERRED
  (user said "we don't need that atm").

Reference: `reference/my-pi-setup/extensions/workflows/dashboard.ts`
(davis's 33KB two-pane dashboard) — read for structure, don't copy
(Effect-based). Our shared UI helpers: `extensions/shared/live-picker.ts`,
`extensions/shared/live-detail.ts`.

### Patterns / gotchas

- TUI components can't be verified headlessly — `pi --mode print` only
  confirms load, not rendering. The user tests interactively; iterate
  with their eyes. Verify logic via vitest on pure helpers (split
  formatting/layout into `src/*.ts` like format.ts/box.ts/gradient.ts).
- Theme colors via `theme.fg(key, text)`; raw RGB via
  `theme.getFgAnsi(key)` (parse `38;2;r;g;b`); `theme.getColorMode()`.
- No window chrome (rounded corners/shadows) — terminal is the window;
  use box-drawing + color. Live agent states (thinking/streaming) are pi
  core, not extension-controllable.
- Commit only when the user asks. Run `npm run verify` (tsc + vitest)
  before committing.

## Deferred backlog (PLAN.md / DESIGN.md)

subagent dispose-on-settle (opt-in keep_alive), worktree isolation,
workflow resume/replay (journal ready), subagent takeover UI, notifications,
protected-ops guard, subagent model roster in skills/subagents/SKILL.md
(still placeholder).
