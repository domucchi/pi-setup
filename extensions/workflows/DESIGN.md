# workflows — design (settled 2026-07-16)

Decisions made with the user; build from this, don't relitigate.

## What it is

One `workflow` tool that executes a model-authored (or saved) JavaScript
orchestration script which fans work out to isolated pi children across
phases. Deterministic control flow (loops, conditionals, fan-out) lives
in the script; the LLM work lives in the agents it spawns.

## Trigger policy (user decision)

Run only when the user explicitly requests a workflow / multi-agent
orchestration — but the model MAY propose one via ask_user when a task
would clearly benefit ("fan this out to N agents?"). The user keeps the
token-spend decision. No magic words. Encode in prompt.ts description +
guidelines.

## Claude Code compatibility (user decision)

Our DSL is a deliberate compatible subset of Claude Code's workflow
dialect, so scripts port both ways:

- Same: `export const meta = {name, description, phases}` (pure literal,
  acorn-validated); `agent(prompt, {label?, phase?, schema?, model?,
  agentType?})`; `parallel(thunks)`; `pipeline(items, ...stages)`;
  `phase(title)`; `log(msg)`; `args`.
- Mapped: CC `effort` option → pi thinking level (scales align).
- Stubbed: `budget` = {total: null, spent: () => 0, remaining: () =>
  Infinity} so CC scripts don't crash. `workflow()` (nesting) throws
  with a clear message. Date.now()/Math.random() throw (deterministic
  resume/replay — same rule as CC).
- Named workflows: `workflow({name})` resolves `.pi/workflows/<name>.js`
  first, then `.claude/workflows/<name>.js` (read-only compat). Dynamic
  `{script}` is the ad-hoc path.

## Sandbox (taken wholesale from the reference — security-critical)

The script is model-authored code; treat it as untrusted:

1. Separate Node child process: `process.execPath --permission
   --allow-fs-read=<sandbox-child dir> --max-old-space-size=128`.
   OS-level: no fs writes, no net, no child processes. Refuse to run if
   `--permission` can't be enforced.
2. Inside the child, the script body runs in a `node:vm` context with
   `codeGeneration: {strings: false, wasm: false}` (no eval / new
   Function), frozen DSL globals, frozen deep-cloned `args`, and
   neutered `process` capabilities (getBuiltinModule/binding/dlopen/
   kill/send) as defense-in-depth.
3. IPC (stdio ignore/ignore/ignore + ipc channel) authenticated by a
   random per-run token; message kinds init/ready/phase/agent/log/
   result/error with byte caps: source 512KB, args 256KB, per-agent
   message 512KB, result 1MB. Protocol violation ⇒ SIGTERM → 1s →
   SIGKILL.
4. `meta` extracted + validated by acorn as a pure literal (getters,
   spreads, computed keys, templates, calls fail closed), then blanked
   from the source preserving line numbers before compilation.

## Agent execution (parent side)

- `agent()` requests are served by reusing subagents' `createChild`
  (trust rules, child denylist, per-tool timeout guard, first-response
  watchdog) with `SessionManager.inMemory` — workflow agents don't
  clutter /resume.
- Roles from agents/*.md apply (`agentType: "explore"` etc.; default
  worker).
- `schema` option (user decision — in v1): the child gets a one-shot
  `report_result` custom tool built from the JSON schema plus an
  appended instruction to call it exactly once; the recorded args are
  the agent's structured return value. agent() without schema returns
  final text.
- runAgent never throws: settles to {ok, output, structured?, error}.
- Caps: concurrency 4 (semaphore shared across parallel/pipeline),
  MAX_AGENT_CALLS = 32 per run.

## Run modes (user decision — both)

- Blocking (default): live progress (phases, agent start/settle)
  streamed into the tool block via onUpdate.
- `background: true`: returns runId immediately; result delivered via
  the shared deferred-followUp machinery (flush when idle or on
  agent_settled), consumed-set semantics like subagents/terminals.

## Persistence, restart rehydration, and resume

- RunId: random (persists ⇒ random, per the ID rule; `wf-` prefix).
- `~/.pi/agent/workflows/<runId>/`: script.js, args.json, meta.json,
  workflow.json (status plus owner PID and normalized originating cwd),
  result.json — atomic writes (temp + rename).
- journal.jsonl has one record per agent() call with the deterministic
  identity {seq, promptHash, optsHash}; its resultRef points to the full
  outcome in agents/<seq>.json. This is why Date.now()/Math.random()
  throw in scripts.
- Each new record stores its owning Pi session ID. On session_start, only
  runs owned by the current session or explicitly referenced by workflow
  results on its active branch are loaded. This preserves restart/fork
  recovery without leaking unrelated global runs into `/workflows`.
  Declared phases come from meta.json and settled agent rows come from journal
  + agent artifacts. Corrupt runs are skipped or degraded to the data that
  remains readable. A selected disk `running` run whose owner PID is still
  alive is foreign and skipped; a dead/legacy owner is changed to `aborted`
  and that normalization is written back when possible.
- session_shutdown first suppresses follow-up delivery, aborts live runs,
  then awaits tracked blocking/background execution through final status
  persistence before the replacement runtime may rehydrate.
- The `workflow` tool's `resume_run_id` input accepts only a settled source
  with a recorded cwd matching the normalized current cwd. It reads the
  source script + args and starts a NEW random run with `resumedFrom` linking
  it to the source. Legacy no-cwd and cross-project runs remain inspectable
  but fail closed for resume.
- Resume reruns the script from the beginning and serves full stored outcomes
  for the matching consecutive {seq, promptHash, optsHash} prefix. Any
  malformed/invalid/duplicate JSONL row disables replay. Each replayed entry
  also requires an exact `agents/<seq>.json` resultRef, a readable full
  outcome, and matching journal/artifact `ok`; the first unavailable or
  mismatched call closes replay and all later calls execute normally.
- Rehydration trusts prompt/full outcome details from an agent artifact only
  when its `ok` matches the journal and resultRef is exact; otherwise the row
  degrades to journal summary fields.
- Replayed calls travel through the same live-agent and persistence path as
  fresh calls. They count toward agentCount, appear settled in status/UI, and
  get exactly one journal row + full agent artifact in the new run, making
  every resumed run independently resumable. Failed replay outcomes keep
  ok=false and therefore resolve to null inside the sandbox.
- Tool result `details` carries the new runId (and resumedFrom when present)
  so forked sessions can point at the artifacts. Blocking and background
  modes both support resume.

## UI

- /workflows: dashboard of live + session-scoped rehydrated disk runs →
  detail view: phases, per-agent status/durations, result preview. `r`
  resumes a settled run in the background; `x` stops a live run. Widget:
  `▸ workflow <name> running` while active.
- renderCall: meta name/description/phases. renderResult: phase-grouped
  agent tree + result summary.

## Deferred (v2+)

- Nested workflow(), budget enforcement, worktree isolation for agents.
- Lazy agent() thenables with unconsumed-call detection.
