# Contributing

Thanks for contributing to pi-setup.

## Development

1. Fork the repository and create a focused branch.
2. Install dependencies with `npm ci`.
3. Make the change and add or update tests.
4. Run `npm run verify`.
5. Open a pull request that explains the motivation, behavior change, and
   verification performed.

Node.js 22.19 or newer is required. Browser tests also require Playwright's
Chromium build (`npx playwright install chromium`).

## Project conventions

- Keep model-facing text in an extension's `prompt.ts`.
- Prefer small, testable modules under `src/`.
- Lean on TypeScript inference and avoid `as any`.
- Never commit credentials, populated `.env` files, MCP configuration, browser
  auth state, or private infrastructure details.
- Keep pull requests scoped; unrelated refactors should be separate.

## Security reports

Follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
