/**
 * One lazily-launched headless chromium per pi session. The browser
 * exists only after the first browser_goto and dies with the session
 * (or via browser_close). Single page by design — the model drives one
 * view, like a human with one tab.
 */

import { chromium, type Browser, type Page } from "playwright";

const VIEWPORT = { width: 1280, height: 720 };
const CONSOLE_BUFFER = 500;
const REQUEST_BUFFER = 300;

export interface ConsoleEntry {
  level: string;
  text: string;
}

export interface RequestEntry {
  method: string;
  url: string;
  status?: number;
  failure?: string;
  resourceType: string;
}

export class BrowserSession {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private launching: Promise<Page> | undefined;
  /** Ring buffers, captured from page creation (not from first ask). */
  readonly consoleLog: ConsoleEntry[] = [];
  readonly requestLog: RequestEntry[] = [];

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
        const page = await context.newPage();
        this.attachInspectors(page);
        this.page = page;
        return page;
      })().finally(() => {
        this.launching = undefined;
      });
    }
    return this.launching;
  }

  private attachInspectors(page: Page) {
    const pushConsole = (entry: ConsoleEntry) => {
      this.consoleLog.push(entry);
      if (this.consoleLog.length > CONSOLE_BUFFER) this.consoleLog.shift();
    };
    const pushRequest = (entry: RequestEntry) => {
      this.requestLog.push(entry);
      if (this.requestLog.length > REQUEST_BUFFER) this.requestLog.shift();
    };
    page.on("console", (message) => {
      pushConsole({ level: message.type(), text: message.text() });
    });
    page.on("pageerror", (error) => {
      pushConsole({ level: "error", text: String(error) });
    });
    page.on("response", (response) => {
      const request = response.request();
      pushRequest({
        method: request.method(),
        url: response.url(),
        status: response.status(),
        resourceType: request.resourceType(),
      });
    });
    page.on("requestfailed", (request) => {
      pushRequest({
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText ?? "failed",
        resourceType: request.resourceType(),
      });
    });
  }

  async dispose() {
    const browser = this.browser;
    this.browser = undefined;
    this.page = undefined;
    this.consoleLog.length = 0;
    this.requestLog.length = 0;
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
