/**
 * browser — a real headless browser as first-class tools, hand-written
 * on the playwright LIBRARY (deliberately not playwright-mcp: tool
 * descriptions and output discipline stay ours; the library is pure
 * plumbing, like pi-mcp-adapter).
 *
 * Model contract: browser_goto / browser_snapshot return an
 * AI-mode aria snapshot with [ref=eN] element references;
 * browser_click / browser_type act on those refs (aria-ref locators)
 * and return a fresh snapshot. browser_screenshot returns a PNG that
 * pi renders directly in the terminal. One lazily-launched chromium
 * per session, disposed on session_shutdown.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  previewOf,
  renderCompactResult,
  resultText,
} from "../shared/compact-result.ts";
import {
  BROWSER_CLICK_DESCRIPTION,
  BROWSER_CLOSE_DESCRIPTION,
  BROWSER_GOTO_DESCRIPTION,
  BROWSER_PROMPT_GUIDELINES,
  BROWSER_PROMPT_SNIPPET,
  BROWSER_SCREENSHOT_DESCRIPTION,
  BROWSER_SNAPSHOT_DESCRIPTION,
  BROWSER_TYPE_DESCRIPTION,
  PARAMETER_DESCRIPTIONS,
} from "./prompt.ts";
import { assertNavigable, BrowserSession } from "./src/session.ts";
import { presentSnapshot } from "./src/snapshot.ts";

const GOTO_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;

export default function browser(pi: ExtensionAPI) {
  const session = new BrowserSession();

  pi.on("session_shutdown", async () => {
    await session.dispose();
  });

  const snapshotOf = async () => {
    const page = session.requirePage();
    const full = await page.ariaSnapshot({
      mode: "ai",
      timeout: SNAPSHOT_TIMEOUT_MS,
    });
    return presentSnapshot(full);
  };

  const pageHeader = async () => {
    const page = session.requirePage();
    const title = await page.title().catch(() => "");
    return `${title || "(untitled)"} — ${page.url()}`;
  };

  /** Compact one-line renderer over the first line of the result. */
  const compactRender = (
    summaryPrefix: string,
  ): Parameters<typeof pi.registerTool>[0]["renderResult"] =>
    function renderResult(result, options, theme) {
      const text = resultText(result);
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        summary: `${summaryPrefix}${previewOf(text, 1)[0] ?? ""}`,
        fullText: text,
      });
    };

  pi.registerTool({
    name: "browser_goto",
    label: "Browser Goto",
    description: BROWSER_GOTO_DESCRIPTION,
    promptSnippet: BROWSER_PROMPT_SNIPPET,
    promptGuidelines: BROWSER_PROMPT_GUIDELINES,
    parameters: Type.Object({
      url: Type.String({ description: PARAMETER_DESCRIPTIONS.url }),
    }),
    async execute(_id, params) {
      assertNavigable(params.url);
      const page = await session.getPage();
      await page.goto(params.url, {
        waitUntil: "domcontentloaded",
        timeout: GOTO_TIMEOUT_MS,
      });
      const header = await pageHeader();
      const snapshot = await snapshotOf();
      return {
        content: [{ type: "text" as const, text: `${header}\n\n${snapshot}` }],
        details: { url: page.url() },
      };
    },
    renderResult: compactRender("→ "),
  });

  pi.registerTool({
    name: "browser_snapshot",
    label: "Browser Snapshot",
    description: BROWSER_SNAPSHOT_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const header = await pageHeader();
      const snapshot = await snapshotOf();
      return {
        content: [{ type: "text" as const, text: `${header}\n\n${snapshot}` }],
        details: {},
      };
    },
    renderResult: compactRender("→ "),
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description: BROWSER_CLICK_DESCRIPTION,
    parameters: Type.Object({
      ref: Type.String({ description: PARAMETER_DESCRIPTIONS.ref }),
      element: Type.String({ description: PARAMETER_DESCRIPTIONS.element }),
    }),
    async execute(_id, params) {
      const page = session.requirePage();
      await page
        .locator(`aria-ref=${params.ref}`)
        .click({ timeout: ACTION_TIMEOUT_MS });
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      const snapshot = await snapshotOf();
      return {
        content: [
          {
            type: "text" as const,
            text: `Clicked ${params.element} (${params.ref}).\n\n${snapshot}`,
          },
        ],
        details: { ref: params.ref, element: params.element },
      };
    },
    renderResult: compactRender("→ "),
  });

  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description: BROWSER_TYPE_DESCRIPTION,
    parameters: Type.Object({
      ref: Type.String({ description: PARAMETER_DESCRIPTIONS.ref }),
      element: Type.String({ description: PARAMETER_DESCRIPTIONS.element }),
      text: Type.String({ description: PARAMETER_DESCRIPTIONS.text }),
      press_enter: Type.Optional(
        Type.Boolean({ description: PARAMETER_DESCRIPTIONS.pressEnter }),
      ),
    }),
    async execute(_id, params) {
      const page = session.requirePage();
      const locator = page.locator(`aria-ref=${params.ref}`);
      await locator.fill(params.text, { timeout: ACTION_TIMEOUT_MS });
      if (params.press_enter) {
        await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
        await page.waitForLoadState("domcontentloaded").catch(() => {});
      }
      const snapshot = await snapshotOf();
      return {
        content: [
          {
            type: "text" as const,
            text: `Filled ${params.element} (${params.ref})${params.press_enter ? " and pressed Enter" : ""}.\n\n${snapshot}`,
          },
        ],
        details: { ref: params.ref, element: params.element },
      };
    },
    renderResult: compactRender("→ "),
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: BROWSER_SCREENSHOT_DESCRIPTION,
    parameters: Type.Object({
      full_page: Type.Optional(
        Type.Boolean({ description: PARAMETER_DESCRIPTIONS.fullPage }),
      ),
    }),
    async execute(_id, params) {
      const page = session.requirePage();
      const buffer = await page.screenshot({
        type: "png",
        fullPage: params.full_page ?? false,
        timeout: ACTION_TIMEOUT_MS,
      });
      const header = await pageHeader();
      return {
        content: [
          { type: "text" as const, text: `Screenshot of ${header}` },
          {
            type: "image" as const,
            data: buffer.toString("base64"),
            mimeType: "image/png",
          },
        ],
        details: { url: page.url(), fullPage: params.full_page ?? false },
      };
    },
    // No custom renderResult: pi's default renders the image in-terminal.
  });

  pi.registerTool({
    name: "browser_close",
    label: "Browser Close",
    description: BROWSER_CLOSE_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const had = session.hasPage();
      await session.dispose();
      return {
        content: [
          {
            type: "text" as const,
            text: had ? "Browser closed." : "No browser was open.",
          },
        ],
        details: {},
      };
    },
  });
}
