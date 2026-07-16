#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pi_home="$HOME/.pi/agent"
skills_src="$HOME/code/infra/agentic-setup/skills"
mode="install"

usage() {
  printf 'usage: %s [--dry-run|--check]\n' "$0"
}

case "${1:-}" in
  "") ;;
  --dry-run) mode="dry-run" ;;
  --check) mode="check" ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 64 ;;
esac

links() {
  printf '%s\t%s\n' "$repo_root/extensions" "$pi_home/extensions"
  printf '%s\t%s\n' "$repo_root/prompts" "$pi_home/prompts"
  if [ -d "$skills_src" ]; then
    for skill in "$skills_src"/*/; do
      printf '%s\t%s\n' "${skill%/}" "$pi_home/skills/$(basename "$skill")"
    done
  fi
}

status=0
while IFS=$'\t' read -r src dest; do
  case "$mode" in
    check)
      if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
        printf '  ok %s -> %s\n' "$dest" "$src"
      else
        printf '  mismatch %s expected -> %s\n' "$dest" "$src" >&2
        status=1
      fi
      ;;
    dry-run)
      printf '  link %s -> %s\n' "$dest" "$src"
      ;;
    install)
      if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
        printf '  ok %s\n' "$dest"
      elif [ -e "$dest" ] || [ -L "$dest" ]; then
        printf '  refusing to overwrite %s\n' "$dest" >&2
        status=1
      else
        mkdir -p "$(dirname "$dest")"
        ln -s "$src" "$dest"
        printf '  linked %s -> %s\n' "$dest" "$src"
      fi
      ;;
  esac
done < <(links)

if [ ! -d "$skills_src" ]; then
  printf '  warn: agentic-setup skills not found at %s, skipped\n' "$skills_src" >&2
fi

exit "$status"
