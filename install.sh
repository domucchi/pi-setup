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
link "$REPO/themes" "$AGENT_DIR/themes"
link "$REPO/AGENTS.md" "$AGENT_DIR/AGENTS.md"

# node_modules must resolve from the extensions' location.
link "$REPO/node_modules" "$AGENT_DIR/node_modules"

echo
echo "Checking external tools:"
command -v fd >/dev/null 2>&1 && echo "  ✓ fd" || echo "  ✗ fd — install with: brew install fd"
command -v rg >/dev/null 2>&1 && echo "  ✓ rg" || echo "  ✗ rg — install with: brew install ripgrep"
command -v gh >/dev/null 2>&1 && echo "  ✓ gh (GitHub PR lookups)" || echo "  · gh not found — GitHub PR info skipped"
command -v glab >/dev/null 2>&1 && echo "  ✓ glab (GitLab MR lookups)" || echo "  · glab not found — GitLab MR info skipped"

# MCP transport is the one piece we install rather than hand-write.
MCP_PKG="npm:pi-mcp-adapter@2.11.0"
echo
if pi list 2>/dev/null | grep -q "pi-mcp-adapter"; then
  echo "MCP: pi-mcp-adapter already installed."
else
  echo "Installing MCP adapter ($MCP_PKG)…"
  pi install "$MCP_PKG" || echo "  ! pi install failed — run it manually: pi install $MCP_PKG"
fi
echo "  Configure servers in $AGENT_DIR/mcp.json (cp mcp.json.example)."

echo
echo "Done. Start pi to load the harness."
