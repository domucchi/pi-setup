/**
 * One lazily-launched headless chromium per pi session. The browser
 * exists only after the first browser_goto and dies with the session
 * (or via browser_close). Single page by design — the model drives one
 * view, like a human with one tab.
 */

import { chromium, type Browser, type Page } from "playwright";

const VIEWPORT = { width: 1280, height: 720 };

export class BrowserSession {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private launching: Promise<Page> | undefined;

  hasPage(): boolean {
    return this.page !== undefined && !this.page.isClosed();
  }

  /** The open page, or an actionable error when navigation never happened. */
  requirePage(): Page {
    if (!this.page || this.page.isClosed()) {
      throw new Error("No page is open. Call browser_goto first.");
    }
    return this.page;
  }

  /** Lazily launch chromium and return the (single) page. */
  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.launching) {
      this.launching = (async () => {
        if (!this.browser?.isConnected()) {
          this.browser = await chromium.launch({ headless: true });
        }
        const context = await this.browser.newContext({ viewport: VIEWPORT });
        this.page = await context.newPage();
        return this.page;
      })().finally(() => {
        this.launching = undefined;
      });
    }
    return this.launching;
  }

  async dispose() {
    const browser = this.browser;
    this.browser = undefined;
    this.page = undefined;
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * URL policy: http(s) only, and the cloud-metadata range is blocked.
 * localhost / LAN hosts are deliberately ALLOWED — inspecting your own
 * dev server is the primary use of this extension (unlike web_fetch,
 * whose SSRF guard fully applies because it fetches blind).
 */
export function assertNavigable(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs can be opened (got ${parsed.protocol}//).`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host.startsWith("169.254.") || host === "metadata.google.internal") {
    throw new Error("Cloud metadata endpoints cannot be opened.");
  }
}
