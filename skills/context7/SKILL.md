---
name: context7
description: Look up current, version-accurate library/framework documentation via the ctx7 CLI. Use when you need up-to-date API/usage docs for a specific library (React, Next.js, Prisma, a CLI, an SDK) rather than relying on training data.
---

# Library docs via ctx7

`ctx7` fetches current, version-pinned documentation to stdout. Prefer it
over web_search/web_fetch when you know the library and want authoritative
API/usage docs. Two steps:

1. **Resolve the library to an ID:**
   ```sh
   ctx7 library <name> "<what you're trying to do>" --json
   ```
   Returns matching libraries with IDs (format `/org/project`), snippet
   counts, and version options. Pick the best-matching ID.

2. **Fetch docs for that ID:**
   ```sh
   ctx7 docs /org/project "<specific question>" --json
   ```
   Returns relevant snippets and explanations.

Run via `bash`. Use `--json` for reliable parsing; drop it for a quick
human-readable read. If `ctx7` is missing, it can be run with
`npx ctx7 …` or installed with `npm install -g ctx7`.

Auth is optional for doc queries. For higher limits, set `CONTEXT7_API_KEY`
(in the environment or `~/.pi/agent/.env`).

## When NOT to use

- General web questions or non-library topics → use web_search / web_fetch.
- Reading the project's own code → use read / rg.
