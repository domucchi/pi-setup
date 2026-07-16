# pi-setup

Configuration and extensions for the [pi](https://pi.dev) coding agent — the
harness-specific layer of the agent stack. Harness-agnostic skills and doctrine
live in [agentic-setup](https://github.com/domucchi/agentic-setup); this repo
only wires pi.

## Layout

- `extensions/` — custom (self-written) pi extensions only (see `extensions/README.md`)
- `prompts/` — prompt templates, auto-discovered by pi
- `install.sh` — symlinks everything into `~/.pi/agent`, including per-skill
  links from agentic-setup's `skills/`

No system-prompt customization: pi's default prompt stays as-is (let the
models cook); steering lives in project `AGENTS.md` files and skills.
- `PLAN.md` — roadmap and principles

## Install

```sh
./install.sh            # create symlinks
./install.sh --dry-run  # show what would be linked
./install.sh --check    # verify existing links
```

Machine-local state (`~/.pi/agent/settings.json`, `auth.json`, `sessions/`)
stays out of this repo and is never symlinked — same rule as `~/.zshrc.local`.

## Third-party extensions

Installed via pi's package manager, reviewed before install, replayed by hand
on a new machine:

```sh
pi install npm:@quintinshaw/pi-dynamic-workflows   # workflows, subagents, model tiers
```

Model tiers for workflow subagents live in `~/.pi/workflows/model-tiers.json`
(machine-local; edit there or via `/workflows-models`).

NOTE: pi must be installed via plain npm (`npm i -g
@earendil-works/pi-coding-agent`), NOT `vp install` — extensions cannot load
under vite-plus's versioned package layout (see FRICTION.md 2026-07-16).
