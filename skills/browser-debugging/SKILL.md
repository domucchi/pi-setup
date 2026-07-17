---
name: browser-debugging
description: Heavy browser work via playwright scripts — network mocking, tracing, auth/storage state, device emulation, multi-tab, downloads. Load when the browser_* tools are not enough.
---

# Browser debugging beyond the tools

The `browser_*` tools cover the interactive loop (navigate, read,
click, type, screenshot, console, network log, evaluate). Everything
heavier is a **playwright script you write and run** — the full library
API with no per-tool plumbing. Prefer a script whenever the task needs
interception, tracing, persistent auth, emulation, or more than one
page.

## Running scripts

playwright (with cached chromium) is installed in the harness, not the
target project. Resolve it via NODE_PATH:

```bash
NODE_PATH=~/.pi/agent/node_modules node /tmp/debug.mjs
```

In the script: `import { chromium, devices, expect } from "playwright";`
(`expect` comes from `playwright/test` — import it only when asserting).
Long-running scripts (watch a flow, keep a trace open) belong in
`bg_start`, one-shots in bash. Always `await browser.close()` in a
`finally`.

## Recipes

**Network interception / mocking**

```js
await page.route("**/api/users", (route) =>
  route.fulfill({ json: [{ id: 1, name: "stub" }] }),
);
await page.route("**/analytics/**", (route) => route.abort());
```

**Tracing** (record, then hand the user the viewer command)

```js
await context.tracing.start({ screenshots: true, snapshots: true });
// … drive the flow …
await context.tracing.stop({ path: "/tmp/trace.zip" });
```

Tell the user to open it with:
`NODE_PATH=~/.pi/agent/node_modules npx playwright show-trace /tmp/trace.zip`

**Auth / storage state** (log in once, reuse forever)

```js
await context.storageState({ path: "/tmp/auth.json" }); // after login
const context2 = await browser.newContext({ storageState: "/tmp/auth.json" });
```

**Device emulation**

```js
import { devices } from "playwright";
const context = await browser.newContext({ ...devices["iPhone 15"] });
```

**Downloads**

```js
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByText("Export").click(),
]);
await download.saveAs(`/tmp/${download.suggestedFilename()}`);
```

**Assertions** (auto-retrying, from playwright/test)

```js
import { expect } from "playwright/test";
await expect(page.getByRole("alert")).toHaveText(/saved/i);
```

## Notes

- Scripts get their own browser — they do NOT share the `browser_*`
  session's page, console, or network log. Do a whole scenario in one
  place: quick inspection → tools; scripted scenario → script.
- `headless: false` opens a visible window — useful when the user
  should watch the flow live.
- Keep artifacts (traces, screenshots, storage state) in /tmp and tell
  the user the paths.
