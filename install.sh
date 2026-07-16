#!/usr/bin/env bash
# Install this harness into ~/.pi/agent by symlinking the versioned
# directories, so edits in this repo take effect live. Idempotent.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

echo "Installing pi harness from $REPO into $AGENT_DIR"
mkdir -p "$AGENT_DIR"

# Dependencies for the extensions (pi loads them in-process via jiti).
echo "Installing npm dependencies…"
(cd "$REPO" && npm install --silent)

link() {
  local target="$1" linkname="$2"
  if [ -e "$linkname" ] && [ ! -L "$linkname" ]; then
    echo "  ! $linkname exists and is not a symlink — skipping (move it aside first)"
    return
  fi
  ln -sfn "$target" "$linkname"
  echo "  linked $(basename "$linkname") -> $target"
}

link "$REPO/extensions" "$AGENT_DIR/extensions"
link "$REPO/agents" "$AGENT_DIR/agents"
link "$REPO/skills" "$AGENT_DIR/skills"
link "$REPO/AGENTS.md" "$AGENT_DIR/AGENTS.md"

# node_modules must resolve from the extensions' location.
link "$REPO/node_modules" "$AGENT_DIR/node_modules"

echo
echo "Checking external tools:"
command -v fd >/dev/null 2>&1 && echo "  ✓ fd" || echo "  ✗ fd — install with: brew install fd"
command -v rg >/dev/null 2>&1 && echo "  ✓ rg" || echo "  ✗ rg — install with: brew install ripgrep"
command -v gh >/dev/null 2>&1 && echo "  ✓ gh (git-info PR lookups)" || echo "  · gh not found — PR info in git-info will be skipped"

echo
echo "Done. Start pi to load the harness."
