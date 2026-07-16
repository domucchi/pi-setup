# pi harness — plan & decisions

Personal pi agent harness. This repo becomes the contents of `~/.pi/agent`
(extensions, skills, themes, AGENTS.md). Fresh start; not derived from any
prior agentic setup.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Build vs install | Write everything that shapes agent behavior ourselves; packages only for pure plumbing | Prompt/policy code must be debuggable and ours; pi extensions run with full system permissions, so third-party code is also a supply-chain risk |
| Language | TypeScript, strict, lean on inference (avoid explicit return types, no `as any`) | Matches pi's extension API; small surface |
| Async model | Plain async/await + `AbortSignal` / `try/finally` / small semaphore helper — **no Effect** | Effect v4 is beta-pinned churn; extensions are 400–2,500 LOC each and don't need fiber machinery; stack traces stay readable |
| Runtime | Node. pi can run under Node or Bun; extensions load in-process via jiti, so they inherit whichever runtime launches pi — it's an all-or-nothing choice at the pi level, never per-extension. Our install launches with Node (verified: `~/.vite-plus/bin/pi` is `#!/usr/bin/env node`), so we target Node only, incl. tests: child_process/signal/stream semantics must match the real runtime. We ship no native modules and control our own environment, so no dual-runtime loaders (cf. pi-fff's fff-bun/fff-node isomorphic loader — a distribution problem we don't have) | Match the runtime we actually run; avoid dual-runtime surface |
| Schemas | `typebox` for tool parameters | pi's native format |
| Tests | **vitest**, on pure-logic modules (output buffers, prompt builders, arg mappers, result delivery) | Fast, TS-native; don't try to test TUI rendering |
| Deps | typebox + vitest, essentially nothing else until workflows needs `acorn` | Keep the loader path boring |
| Dev tooling | vite-plus as dev front end (`vite test`/`vite lint`/`vite fmt`, one config) and as installer for the pi binary. **Never in the runtime path** — pi + jiti own extension loading (vp loader bug already bitten once, see commit c811dae) | Plumbing, not behavior-shaping; bare vitest + tsc is a 5-min fallback |

## Repo layout (target)

```
extensions/<name>/index.ts     # wiring: registerTool/registerCommand/events
extensions/<name>/prompt.ts    # ALL model-facing text: description, promptSnippet, promptGuidelines, param descriptions
extensions/<name>/src/*.ts     # logic (pure where possible → testable)
extensions/<name>/*.test.ts
extensions/shared/             # cross-extension helpers (child-session policy, semaphore, bounded output)
skills/<name>/SKILL.md
themes/
AGENTS.md                      # global agent guidance loaded by pi
```

Setup: clone/symlink to `~/.pi/agent`, `npm install`.

## Build order

1. **git-info** — branch/changed-files/PR in footer. Learn events + `ctx.ui.setStatus`.
   Patterns: generation counter reset on `session_start`; refresh on `input` +
   `tool_execution_end` + slow poll; `/lg` changed-files browser; `gh pr view` only
   on branch change or explicit `/pr`.
2. **ask-user** — tool: 2–5 model options + always-present "write my own answer",
   number-key shortcuts, Esc = declined (reported honestly to the model), no-op
   with clear message outside TUI. First `ctx.ui.custom` + renderCall/renderResult.
3. **background-terminals** — `bg_start` / `bg_status` / `bg_list` / `bg_kill`.
   No stdin by design. Patterns: record exit code on `exit` but settle on `close`
   (flushed output); SIGTERM→SIGKILL process-group kill; bounded ring buffer
   (~2MB/stream) with full spill to owner-only temp files; deferred result
   delivery (below); widget above editor only while running, re-rendered only
   when the running *count* changes; `/ps` overlay. Ephemeral: kill all on
   `session_shutdown`.
4. **file-search** — `fd` + `rg` as first-class tools. Mostly prompt.ts + output
   truncation (line/byte caps, full output saved to temp file, path returned).
   Guidelines steer model: fd for names, rg for contents, bash only for pipelines.
5. **subagents** — in-process pi SDK children (`createAgentSession()`), **pi
   backend only** (no claude/codex backends — 1KLOC of protocol defensiveness
   for marginal value; revisit only on felt need). Tools: `subagent_spawn` /
   `subagent_wait` / `subagent_check` / `subagent_cancel` / `subagent_list`.
   `MAX_RUNNING=4` with synchronous reservation before first await. Normalized
   event union → single snapshot fold. `/subagents` takeover UI last. Ephemeral
   across session switches (v1).
6. **workflows** — last, only once subagent usage patterns are felt. Steal the
   sandbox design wholesale: separate Node child with `--permission`
   fs-read-only + `node:vm` context with codegen disabled + token-authenticated
   IPC with byte budgets + acorn-validated pure-literal `meta`. Persist runs to
   `~/.pi/agent/workflows/<runId>/` (atomic writes); tool `details` carries
   `runId` so forked sessions re-hydrate from disk. Pick our own trigger policy
   for the tool description (reference repo gates on the word "ultracode").

Later candidates (not committed): **ui-customization** (own the whole footer
via `ctx.ui.setFooter(factory)` — receives TUI, theme, and FooterDataProvider
with branch + all extension statuses; do this once aesthetics start to matter,
cf. reference's `ui-customization`; note pi's built-in footer already shows
the git branch, so status segments should only add non-native info),
notifications on settle, protected-ops bash guard, web access, LSP
diagnostics (`pi-lens` is an acceptable install — pure plumbing).

## Pattern library (from reference repo — port, don't copy)

- **Deferred result delivery**: background completions go into a map keyed by
  run id; flush via `pi.sendMessage({customType, details}, {deliverAs:
  "followUp", triggerTurn: true})` immediately if session idle, else on
  `agent_settled`. Map drain = structurally no double delivery.
- **State in tool-result `details`**: pi replays tool results on fork/branch —
  `details` must let renderers work standalone; durable state goes to disk
  keyed by an id carried in `details`.
- **Child tool denylist**: children never get `subagent_*`, `workflow`,
  `ask_user`. Policy fn returns a **fresh array** per call (shared mutable
  array turns a denylist into an accidental allowlist).
- **Child trust**: same-cwd children inherit live parent trust; other cwds only
  if pi's persisted ProjectTrustStore says so; fail closed.
- **Settle discipline**: single idempotent settle guard (`if (status !==
  "running") return`); sync capacity reservation before first await.
- **Occupancy vs cumulative tokens**: context gauges must use per-request
  usage, not the cumulative aggregate (pins at 100%).
- **prompt.ts as first-class module**: all model-facing text in one reviewable
  file per extension; guidelines phrased as tool-routing rules.
- **prompt.ts vs skill**: guidelines are always-on (cost tokens every request)
  — short routing rules only. Skills cost one description line until loaded —
  long, procedural, or often-edited content (e.g. subagent model roster /
  routing doctrine goes in skills/subagents/SKILL.md, not prompt.ts; tool
  mechanics stay in prompt.ts). Don't put always-on-worthy one-liners behind a
  skill (reference's background-terminals skill made that mistake).
- **Lifecycle hygiene**: every resource registered in a disposables list
  drained on `session_shutdown`; session switch (`/new`/`/fork`/`/resume`)
  reloads extensions — captured objects go stale.
- **Per-tool timeout guard** on child sessions (~3 min via `AbortSignal.any`)
  so a hung child tool can't wedge a subagent forever.

## Explicitly rejected

- Effect (any version) — see Decisions.
- Bun — possible only by launching pi itself under Bun (extensions inherit pi's runtime); rejected because our pi runs under Node and dual-runtime validation buys us nothing.
- Multi-harness subagent backends (claude/codex) in v1; note the reference's
  claude backend runs headless `bypassPermissions` — if ever added, decide that
  deliberately.
- Firecrawl — paid API, author preference; choose web access separately.
- Installing behavior-shaping community packages (subagents/plan/todo/memory).

## References

- Reference implementation: https://github.com/davis7dotsh/my-pi-setup
  (read for rationale; do not copy — Effect v4 beta, personal toolchain).
  Local vendored copy: `reference/my-pi-setup/` (gitignored).
- pi extension API: https://pi.dev/docs/latest/extensions
- pi usage / built-ins: https://pi.dev/docs/latest/usage
- Bundled examples: `earendil-works/pi` → `examples/extensions/`
