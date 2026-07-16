# pi-setup

A personal [pi](https://pi.dev) coding-agent harness, built by hand in
plain TypeScript. Everything that shapes agent behavior is written here
rather than installed as a package.

## Extensions

- **git-info** — branch dirty-count and open-PR info in the footer; `/pr`.
- **ask-user** — the model asks a multiple-choice question; `Tab` attaches
  a note to the selected option.
- **background-terminals** — `bg_start`/`bg_status`/`bg_list`/`bg_kill` for
  long-running processes; `/ps` to inspect.
- **file-search** — `fd` and `rg` as first-class tools.
- **subagents** — in-process pi children with markdown roles
  (`agents/*.md`), interactive `subagent_send`; `/subagents`.
- **workflows** — model-authored orchestration scripts run in a
  sandboxed child; Claude Code-compatible DSL; `/workflows`.

## Setup

See [SETUP.md](./SETUP.md). Short version: run `./install.sh`.

## Design

`PLAN.md` records the decisions and pattern library; each larger
extension has its own `DESIGN.md`.
