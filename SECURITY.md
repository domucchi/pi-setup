# Security policy

## Supported versions

Security fixes are applied to the latest revision of the `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
**Report a vulnerability** flow in the repository's Security tab so details
remain private while the report is reviewed.

Include the affected component, reproduction steps, expected impact, and any
suggested mitigation. You should receive an initial response within seven
days.

## Trust model

pi extensions execute with the permissions of the pi process. This repository
also includes optional Claude and Codex subagent backends that intentionally
run without interactive permission prompts. Only run code and configure MCP
servers you trust, keep credentials in environment variables or the local
`.env` file, and review changes before installing them.
