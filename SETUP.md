# Setup

This repo becomes the contents of `~/.pi/agent` via symlinks, so edits
here take effect the next time pi starts — no copy step, and the harness
stays versioned in git.

## Install

```sh
./install.sh
```

This installs npm dependencies and symlinks `extensions/`, `agents/`,
`skills/`, `AGENTS.md`, and `node_modules/` into `~/.pi/agent`
(overriding the target with `PI_AGENT_DIR`). It is idempotent and skips
any target that already exists as a real file.

## External tools

- **fd** and **rg** — required by the file-search extension
  (`brew install fd ripgrep`, or your package manager). The extension
  fails a call with an install hint if either is missing.
- **gh** / **glab** — optional; git-info shows the open PR (GitHub) or MR
  (GitLab) for the current branch, picking the CLI from the remote URL. It
  silently skips the lookup when the matching CLI is absent.

## Web access

`web_fetch` needs no setup — it fetches and extracts pages locally. `web_search`
uses [Exa](https://exa.ai) (20k requests/month free tier). Provide `EXA_API_KEY`
either as a shell/CI env var or in `~/.pi/agent/.env` (`cp .env.example` there and
fill it in — that file lives outside the repo and is gitignored). Extensions read
`process.env` first, then `~/.pi/agent/.env`. Without the key, `web_search`
returns a hint and `web_fetch` still works.

## Extensions run under Node

pi loads extensions in-process via jiti, so they run under whatever
runtime launched pi (Node here). No build step — pi executes the
TypeScript directly.

## MCP servers

MCP (external tool servers) is provided by the installed `pi-mcp-adapter`
package rather than a hand-written extension — it's pure transport plumbing.
Install it (also done by `install.sh`):

```sh
pi install npm:pi-mcp-adapter@2.11.0
```

Configure servers in `~/.pi/agent/mcp.json` (`cp mcp.json.example` there). The
schema is the standard `mcpServers` object — the same servers work in Claude
Code. Keep secrets out of the file with `${VAR}` interpolation (resolved from
the environment / `~/.pi/agent/.env`); the real `mcp.json` is gitignored.

By default the adapter exposes servers through a single lean proxy tool and
discovers their tools on demand, so a server with dozens of tools doesn't flood
the context. Use `directTools: ["a", "b"]` per server to register specific tools
directly, or `excludeTools` to hide noisy ones.

**Trust:** each configured server is the real trust decision — stdio servers run
processes, remote servers make network calls. Add servers you trust, like any
dependency.

## Themes

Themes live in `themes/*.json` (symlinked into `~/.pi/agent/themes`). Included:
`github-dark` (GitHub Dark / Primer palette, the default), `github-dark-pink`
(same chrome, pink accents), and `catppuccin-mocha` (pastel). pi also ships
`dark` and `light`. Switch any time via `/settings` in the TUI, or set
`"theme": "<name>"` in `~/.pi/agent/settings.json`. Add a theme by dropping
another JSON in `themes/` (all 52 `colors` keys required — see the schema in
each file's `$schema`).

## Development

- `npm test` — vitest (pure-logic modules, the sandbox, arg builders).
- `npm run check` — `tsc --noEmit`.

The sandbox tests spawn real `--permission` Node child processes, so
they exercise the actual isolation boundary.
