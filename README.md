# pi-setup

Configuration and extensions for the [pi](https://pi.dev) coding agent — the
harness-specific layer of the agent stack. Harness-agnostic skills and doctrine
live in [agentic-setup](https://github.com/domucchi/agentic-setup); this repo
only wires pi.

## Layout

- `extensions/` — vendored and custom pi extensions (policy in `extensions/README.md`)
- `prompts/` — prompt templates, auto-discovered by pi
- `APPEND_SYSTEM.md` — appended to pi's default system prompt
- `install.sh` — symlinks everything into `~/.pi/agent`, including per-skill
  links from agentic-setup's `skills/`
- `PLAN.md` — roadmap and principles

## Install

```sh
./install.sh            # create symlinks
./install.sh --dry-run  # show what would be linked
./install.sh --check    # verify existing links
```

Machine-local state (`~/.pi/agent/settings.json`, `auth.json`, `sessions/`)
stays out of this repo and is never symlinked — same rule as `~/.zshrc.local`.
