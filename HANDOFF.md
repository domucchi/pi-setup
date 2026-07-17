# Handoff — pi harness UI work

## State (2026-07-17)

Functionally complete harness (8 hand-written extensions + MCP via
pi-mcp-adapter) with the full UI pass DONE. 172 vitest tests, tsc clean.
See `PLAN.md` for architecture/decisions; `README.md`/`SETUP.md` for the map.

### Shipped UI (this round)

- **Per-agent telemetry**: `RunnerEvent` has an "activity" state carrying
  model/tokens/contextWindow/toolCalls/preview from the child session;
  `ActiveAgent` (workflows) and `SubagentSnapshot` (subagents) carry
  prompt, toolCalls, recentActivity, output/report head. `meta.phases`
  is kept on `ActiveRun`.
- **Overlay dashboards** (no inline pickers): `/workflows` = Runs list →
  Phases│agents two-pane → agent detail (p expands prompt, x stops the
  run; auto-enters when exactly one run). `/subagents` = agent list →
  detail (prompt/activity/report/transcript, x cancels). Shared
  primitives: `extensions/shared/overlay.ts` (split/panel/
  dashboardHeight/OverlayTheme) + `extensions/shared/agent-format.ts`
  (pure, tested). Overlays anchor top-center and fill everything above
  the input area (dashboardHeight measures pi's last three components:
  editor, below-widgets, footer).
- **Under-input indicators** (`placement: "belowEditor"`): per-state
  counts `◆ N running · ✓ N done · ✗ N failed`; settled entries linger
  60s (WIDGET_LINGER_MS) then drop; widget set ONCE per visible spell
  (re-setting reorders widgets — setWidget moves the key to map end);
  5s ticker expires lingerers. No keyboard nav by user request —
  commands are the entry points.
- **Demo mode**: `/workflows demo` and `/subagents demo` preview all UI
  over mutable fixtures (`src/demo.ts` in each) — x actually mutates
  them; demo widget lingers 20s after the overlay closes.
- **ui-customization**: footer is now model ● thinking ⟷ cost · context;
  sticky-bottom input via a high-water filler widget (measures all tui
  children per frame with a re-entrancy guard; buffer NEVER shrinks —
  shrink after overflow causes full-redraw + scrollback duplication).
  `/sticky` toggles.

### Gotchas (hard-won)

- pi-coding-agent bundles its OWN pi-tui copy: `instanceof` on pi-tui
  objects across the extension boundary is ALWAYS false. Use structural
  checks / re-entrancy guards.
- TUI components can't be verified headlessly — `pi --mode print` only
  confirms load. Iterate with the user's eyes; pure logic goes in
  src/*.ts with vitest.
- The inline renderer can't unscroll; never let the logical buffer
  shrink after it has overflowed the screen.
- Scroll-up-pinned input is impossible (terminal scrollback is
  emulator-side; pi is not an alternate-screen app).
- Commit only when the user asks. `npm run verify` before committing.

### User-local settings NOT in the repo (`~/.pi/agent/settings.json`)

`theme: "rose-pine"`, `editorPaddingX: 2`, `outputPad: 1`. Documented in
SETUP.md.

## Deferred backlog (PLAN.md / DESIGN.md)

Jump into a subagent's live session (takeover UI), subagent
dispose-on-settle (opt-in keep_alive), worktree isolation, workflow
resume/replay (journal ready), notifications, protected-ops guard,
subagent model roster in skills/subagents/SKILL.md (still placeholder),
/workflows rehydration of past runs from disk.
