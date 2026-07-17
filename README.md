# pi-setup

[![CI](https://github.com/domucchi/pi-setup/actions/workflows/ci.yml/badge.svg)](https://github.com/domucchi/pi-setup/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

An opinionated, batteries-included [pi](https://pi.dev) coding-agent harness,
built in plain TypeScript. Everything that shapes agent behavior is written
here rather than hidden inside a package.

## Extensions

- **git-info** — branch dirty-count and open-PR info above the input; `/pr`.
- **ask-user** — the model asks 1-5 multiple-choice questions in one form
  (single/multi-select, free-form answers, `Tab` attaches a note).
- **background-terminals** — `bg_start`/`bg_status`/`bg_list`/`bg_kill` for
  long-running processes; `/ps` to inspect.
- **file-search** — `fd` and `rg` as first-class tools.
- **subagents** — children with markdown roles (`agents/*.md`) on three
  backends: in-process pi (default), real Claude Code (Agent SDK), and
  real Codex (`app-server`); interactive `subagent_send`; `/subagents`.
- **workflows** — model-authored orchestration scripts run in a
  sandboxed child; Claude Code-compatible DSL; `/workflows`,
  `workflow_status` for polling background runs.
- **web-access** — `web_fetch` (keyless, local HTML→markdown) and
  `web_search` (Exa; set `EXA_API_KEY`).
- **browser** — a headless chromium as first-class tools
  (`browser_goto`/`_snapshot`/`_click`/`_type`/`_screenshot`/`_console`/
  `_evaluate`/`_requests`/`_close`) on aria snapshots with `[ref=eN]`
  element references; screenshots render in the terminal. Heavy work
  (mocking, tracing, auth state) goes through playwright scripts — see
  the `browser-debugging` skill. Built on the playwright library, no MCP.
- **todos** — `todo_write` (Claude Code TodoWrite semantics); live
  checklist above the input.
- **session-title** — a cheap model names each session from its first
  prompt (tab title + `/resume` label).
- **ui-customization** — header/footer/theme chrome, sticky input,
  working timer, status-noise suppression.

MCP servers are provided by the installed `pi-mcp-adapter` package (the one
piece deliberately not hand-written — it's pure transport plumbing); configure
servers in `~/.pi/agent/mcp.json`. See [SETUP.md](./SETUP.md).

## Setup

See [SETUP.md](./SETUP.md). Short version: run `./install.sh`.

## Trust and security

pi extensions run with the permissions of the pi process. Review the code and
configured MCP servers before use. The optional Claude and Codex subagent
backends intentionally run without interactive permission prompts; see
[SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

## Design

`PLAN.md` records the decisions and pattern library; each larger extension has
its own `DESIGN.md`.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before
opening a pull request.

## License

[MIT](./LICENSE)
