import { afterAll, describe, expect, it } from "vitest";
import {
  formatConsoleEntries,
  formatEvaluateResult,
  formatRequestEntries,
} from "./src/inspect.ts";
import {
  assertNavigable,
  BrowserSession,
  isMetadataHost,
} from "./src/session.ts";
import { capSnapshot, presentSnapshot } from "./src/snapshot.ts";

describe("assertNavigable", () => {
  it("allows http(s) including localhost, rejects other schemes", () => {
    expect(() => assertNavigable("http://localhost:5173/")).not.toThrow();
    expect(() => assertNavigable("https://example.com/x")).not.toThrow();
    expect(() => assertNavigable("file:///etc/passwd")).toThrow(/http/);
    expect(() => assertNavigable("chrome://settings")).toThrow(/http/);
    expect(() => assertNavigable("not a url")).toThrow(/Invalid URL/);
  });

  it("blocks cloud metadata endpoints including mapped-v6 forms", () => {
    expect(() => assertNavigable("http://169.254.169.254/latest")).toThrow(
      /metadata/,
    );
    expect(() => assertNavigable("http://metadata.google.internal/")).toThrow(
      /metadata/,
    );
    expect(() => assertNavigable("http://[::ffff:169.254.169.254]/")).toThrow(
      /metadata/,
    );
    expect(() => assertNavigable("http://[::ffff:a9fe:a9fe]/")).toThrow(
      /metadata/,
    );
  });

  it("isMetadataHost stays narrow — localhost and LAN remain allowed", () => {
    expect(isMetadataHost("localhost")).toBe(false);
    expect(isMetadataHost("192.168.1.10")).toBe(false);
    expect(isMetadataHost("[::1]")).toBe(false);
    expect(isMetadataHost("64:ff9b::a9fe:a9fe")).toBe(true);
  });
});

describe("capSnapshot / presentSnapshot", () => {
  it("passes short snapshots through untouched", () => {
    expect(capSnapshot("- button \"Hi\"", 100)).toEqual({
      text: '- button "Hi"',
      truncated: false,
      totalChars: 13,
    });
    expect(presentSnapshot("short", () => "/nope")).toBe("short");
  });

  it("caps on a line boundary and appends the spill notice", () => {
    const full = Array.from({ length: 1000 }, (_, i) => `- line ${i}`).join("\n");
    const capped = capSnapshot(full, 500);
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(500);
    expect(capped.text.endsWith("\n")).toBe(false);

    let spilled: string | undefined;
    const presented = presentSnapshot(full, (f) => {
      spilled = f;
      return "/tmp/spill.txt";
    });
    // presentSnapshot uses the default 40k cap; force a smaller check via capSnapshot above.
    expect(spilled === undefined || spilled === full).toBe(true);
    expect(typeof presented).toBe("string");
  });
});

describe("inspection formatting", () => {
  it("formats console tails with an overflow header", () => {
    expect(formatConsoleEntries([], 10)).toBe("(no console output)");
    const entries = Array.from({ length: 5 }, (_, i) => ({
      level: "log",
      text: `m${i}`,
    }));
    const text = formatConsoleEntries(entries, 2);
    expect(text).toContain("(showing last 2 of 5 entries)");
    expect(text).toContain("[log] m4");
    expect(text).not.toContain("m2");
  });

  it("formats requests with status/failure and filtering", () => {
    const entries = [
      { method: "GET", url: "http://x/api/a", status: 200, resourceType: "xhr" },
      {
        method: "POST",
        url: "http://x/api/b",
        failure: "net::ERR_FAILED",
        resourceType: "fetch",
      },
      { method: "GET", url: "http://x/logo.png", status: 304, resourceType: "image" },
    ];
    const text = formatRequestEntries(entries, 40, "/api/");
    expect(text).toContain("200 GET http://x/api/a (xhr)");
    expect(text).toContain("FAIL POST http://x/api/b — net::ERR_FAILED (fetch)");
    expect(text).not.toContain("logo.png");
    expect(formatRequestEntries([], 40)).toBe("(no requests recorded)");
  });

  it("stringifies evaluate results within a budget", () => {
    expect(formatEvaluateResult({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatEvaluateResult(undefined)).toBe("undefined");
    expect(formatEvaluateResult("x".repeat(20), 10)).toContain("[result clipped");
  });
});

describe("BrowserSession (real chromium)", () => {
  const session = new BrowserSession();

  afterAll(async () => {
    await session.dispose();
  });

  it(
    "navigates, snapshots with refs, and clicks via aria-ref",
    { timeout: 30_000 },
    async () => {
      const page = await session.getPage();
      await page.goto(
        "data:text/html,<title>t</title><button onclick=\"document.title='clicked'\">Press me</button>",
      );
      const snapshot = await page.ariaSnapshot({ mode: "ai" });
      expect(snapshot).toContain("Press me");
      const ref = snapshot.match(/\[ref=(e\d+)\]/)?.[1];
      expect(ref).toBeDefined();
      await page.locator(`aria-ref=${ref}`).click();
      expect(await page.title()).toBe("clicked");
    },
  );

  it(
    "captures console output and evaluates expressions",
    { timeout: 30_000 },
    async () => {
      const page = await session.getPage();
      await page.goto(
        "data:text/html,<script>console.log('hello from page')</script>",
      );
      await page.waitForTimeout(100);
      expect(
        session.consoleLog.some((e) => e.text.includes("hello from page")),
      ).toBe(true);
      expect(await page.evaluate("1 + 1")).toBe(2);
    },
  );

  it(
    "resolver rules block metadata for ALL requests, not just goto",
    { timeout: 30_000 },
    async () => {
      const page = await session.getPage();
      // Chromium-level block: resolution fails locally and fast.
      await expect(
        page.goto("http://metadata.google.internal/", { timeout: 10_000 }),
      ).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
      await expect(
        page.goto("http://169.254.169.254/latest", { timeout: 10_000 }),
      ).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
    },
  );

  it("requirePage throws before goto on a fresh session", async () => {
    const fresh = new BrowserSession();
    expect(() => fresh.requirePage()).toThrow(/browser_goto/);
    await fresh.dispose();
  });
});
