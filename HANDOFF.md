# Handoff — pi harness UI work

## State (2026-07-17)

Functionally complete harness (10 hand-written extensions + MCP via
pi-mcp-adapter) with the full UI pass DONE. 186 vitest tests, tsc clean.
See `PLAN.md` for architecture/decisions; `README.md`/`SETUP.md` for the map.

## Big builds: DONE

### DONE: claude/codex subagent backends

`agents/*.md` roles carry `backend: pi|claude|codex` (starter roles
agents/claude.md, agents/codex.md). Externals implement ChildHandle in
extensions/subagents/src/backends/ — claude = Agent SDK query()
streaming-input bridge (bypassPermissions; steer = native mid-run
queue), codex = `codex app-server --stdio` JSON-RPC (approvalPolicy
never + danger-full-access; NO mid-run steering — steer() throws with
guidance). Binary resolution skips cmux shims (resolve.ts). Workflows
route through the same dispatch; schema on a non-pi agentType fails
with a clear error (report tool is pi-only). Model hints pass through
natively ("opus", "gpt-5.3-codex"), never pi registry ids. Verified
end-to-end against BOTH real CLIs (a throwaway vitest file driving
createClaudeChild/createCodexChild with "reply BACKEND-OK" — not kept
in the suite, it costs real tokens per run). Routing doctrine:
skills/subagents/SKILL.md.

### DONE: browser extension (extensions/browser/)

Built on playwright's PUBLIC ai-snapshot API: `page.ariaSnapshot({mode:
"ai"})` emits [ref=eN] references and `page.locator("aria-ref=eN")`
resolves them (same mechanics as playwright-mcp, no private APIs).
Six tools: goto/snapshot/click/type/screenshot(→ ImageContent, renders
in-terminal)/close. Lazy chromium per session, disposed on shutdown.
URL policy: http(s) only, cloud-metadata blocked, localhost ALLOWED by
design (dev-server inspection is the point). 40k-char snapshot cap with
temp-file spill. Real-chromium integration test in browser.test.ts.

### claude/codex subagent backends

Decision made: bypassPermissions is FINE (user: permission prompts are
bloat; real sandboxing later). Reference: davis's
`reference/my-pi-setup/extensions/subagents/src/backends/{claude,codex}.ts`
— claude uses @anthropic-ai/claude-agent-sdk `query()` streaming with
permissionMode bypassPermissions; codex spawns the `codex` CLI parsing
JSON events. Our seam: implement `ChildHandle` (subagents/src/child.ts)
per backend — manager, dashboards, widgets, result delivery all reuse.
Plumb `backend: "pi" | "claude" | "codex"` through agents/*.md role
definitions + subagent_spawn param. Telemetry mapping: their events →
run-started/activity/run-settled (+ usage where available). Workflows
get backends for free via createChild-compatible wiring. Motivation:
Claude models unavailable in pi directly; codex brings computer use.

### Round 3 additions (same day)

- Collapsed agent outputs: workflow/workflow_status/subagent_wait tool
  results + workflow/subagent/bg follow-up messages render as summary
  lines (ctrl+o expands; message renderers get `expanded` too).
- workflow_status tool (poll background runs; denied to children) and
  full agent prompts persisted in run artifacts (agents/<seq>.json).
- ask_user redesigned: 1-5 questions per call, CC-style tab bar
  (← ☒/☐ headers · ✓ Submit →), single-select auto-advances,
  multi_select with explicit "✓ Done — continue" row (enter toggles, so
  Done is the ONLY way to finish a single multi-select question —
  learned the hard way), review page on Submit. Pure state in
  src/form.ts.
- todos extension (10th): todo_write, CC TodoWrite semantics (full-list
  replace); checklist in chat + live aboveEditor widget (all-done
  lingers 60s). SGR 9 strikethrough for completed.
- Model/thinking status suppression hardened: also swallows "Model: X" /
  "Switched to …", AND wraps setText — showStatus mutates the previous
  status line in place when it is still last (the add-path filter alone
  broke after the first allowed status landed).
- Session titles: sentence-cased deterministically (luna Title-Cases no
  matter the prompt), 3-6 words; tab shows state glyph — ◆ working,
  π settled.

### Round 2 additions (same day)

- Minimal Claude-style header: 4-row pixel π mascot (gradient), name/
  version/tagline/cwd; no box, no model line (headers freeze into
  scrollback — never show session-mutable info there).
- Themes: github-dark (default) + github-dark-pink; rose-pine deleted.
- "Thinking level: X" chat status swallowed pre-render (container
  addChild wrap in ui-customization — post-hoc removal flickers).
- session-title extension (9th): first real prompt → gpt-5.6-luna names
  the session via sessionManager.appendSessionInfo (native: /resume label
  + title), then the tab is overridden to the bare topic.
- Compact tool results (shared/compact-result.ts): fd/rg/web_search/
  web_fetch collapse to dim one-liners; ctrl+o expands. Display-only.
- background-terminals matches the others: /ps overlay dashboard (live
  tails auto-follow, x kills) + per-state widget counts + /ps demo.
- Widget strips: aligned muted label column (agents/terminals/workflows),
  unified ◆ running glyph, /command in accent.
- Working timer: loader ticks "Working... Ns"; on settle a "worked-for"
  custom entry renders "✓ worked for Ns" (entries never enter model
  context).

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

`theme: "github-dark"`, `editorPaddingX: 2`, `outputPad: 1`. Documented in
SETUP.md.

## Deferred backlog (PLAN.md / DESIGN.md)

Jump into a subagent's live session (takeover UI), subagent
dispose-on-settle (opt-in keep_alive), worktree isolation, workflow
resume/replay (journal ready), notifications, protected-ops guard,
subagent model roster in skills/subagents/SKILL.md (still placeholder),
/workflows rehydration of past runs from disk.
