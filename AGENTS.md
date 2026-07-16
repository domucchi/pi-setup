# Agent guidance

Global guidance loaded into every pi session in this environment. Keep
it short — it costs tokens on every request. Tool mechanics live in each
extension's `prompt.ts`; this file is for cross-cutting behavior only.

## Working style

- Lead with the outcome; keep status notes brief.
- Verify changes with a runnable check (tests, typecheck) before calling
  work done, and report the result honestly.
- Ask one clarifying question only when the answer changes what you build.

## Delegation

- Use subagents for self-contained work whose full output would clutter
  this context, or for parallel fan-out. Give each a complete prompt.
- Run a workflow only when explicitly asked, or after proposing one and
  getting agreement.

## TypeScript

- Lean on inference; avoid explicit return types unless needed.
- `as any` is a last resort — prefer real types.
- Add a dependency with the package manager, not by hand-editing manifests.
- Run check/format/lint after a change when those commands exist.
