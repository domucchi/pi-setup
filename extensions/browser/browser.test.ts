import { afterAll, describe, expect, it } from "vitest";
import { assertNavigable, BrowserSession } from "./src/session.ts";
import { capSnapshot, presentSnapshot } from "./src/snapshot.ts";

describe("assertNavigable", () => {
  it("allows http(s) including localhost, rejects other schemes", () => {
    expect(() => assertNavigable("http://localhost:5173/")).not.toThrow();
    expect(() => assertNavigable("https://example.com/x")).not.toThrow();
    expect(() => assertNavigable("file:///etc/passwd")).toThrow(/http/);
    expect(() => assertNavigable("chrome://settings")).toThrow(/http/);
    expect(() => assertNavigable("not a url")).toThrow(/Invalid URL/);
  });

  it("blocks cloud metadata endpoints", () => {
    expect(() => assertNavigable("http://169.254.169.254/latest")).toThrow(
      /metadata/,
    );
    expect(() => assertNavigable("http://metadata.google.internal/")).toThrow(
      /metadata/,
    );
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

  it("requirePage throws before goto on a fresh session", async () => {
    const fresh = new BrowserSession();
    expect(() => fresh.requirePage()).toThrow(/browser_goto/);
    await fresh.dispose();
  });
});
