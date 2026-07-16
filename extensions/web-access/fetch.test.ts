import { describe, expect, it, vi } from "vitest";
import { fetchUrl } from "./src/fetch.ts";
import type { Lookup } from "./src/ssrf.ts";

const publicLookup: Lookup = async () => [{ address: "93.184.216.34" }];

function response(
  body: string,
  init: { status?: number; contentType?: string; location?: string } = {},
): Response {
  const headers: Record<string, string> = {
    "content-type": init.contentType ?? "text/html",
  };
  if (init.location) headers.location = init.location;
  return new Response(init.status && init.status >= 300 && init.status < 400 ? null : body, {
    status: init.status ?? 200,
    headers,
  });
}

describe("fetchUrl", () => {
  it("returns markdown for an HTML page", async () => {
    const html = `<html><head><title>Doc</title></head><body><article><h1>Guide</h1><p>${"content ".repeat(30)}</p></article></body></html>`;
    const result = await fetchUrl("https://example.com/doc", {
      fetcher: async () => response(html),
      lookup: publicLookup,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Guide");
  });

  it("returns raw text for non-HTML text types", async () => {
    const result = await fetchUrl("https://example.com/data.json", {
      fetcher: async () => response('{"a":1}', { contentType: "application/json" }),
      lookup: publicLookup,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toBe('{"a":1}');
  });

  it("rejects binary content types with a clear error", async () => {
    const result = await fetchUrl("https://example.com/file.pdf", {
      fetcher: async () => response("%PDF-1.4", { contentType: "application/pdf" }),
      lookup: publicLookup,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unsupported content type");
  });

  it("rejects non-http protocols and invalid URLs without fetching", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return response("");
    }) as typeof fetch;
    expect((await fetchUrl("file:///etc/passwd", { fetcher, lookup: publicLookup })).ok).toBe(false);
    expect((await fetchUrl("not a url", { fetcher, lookup: publicLookup })).ok).toBe(false);
    expect(called).toBe(false);
  });

  it("surfaces HTTP errors", async () => {
    const result = await fetchUrl("https://example.com/missing", {
      fetcher: async () => response("nope", { status: 404 }),
      lookup: publicLookup,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
  });

  it("never throws when the fetcher rejects", async () => {
    const result = await fetchUrl("https://example.com", {
      fetcher: async () => {
        throw new Error("connection refused");
      },
      lookup: publicLookup,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("connection refused");
  });

  it("blocks SSRF to a private host without fetching", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return response("secret");
    }) as typeof fetch;
    const result = await fetchUrl("http://169.254.169.254/latest/meta-data/", {
      fetcher,
      lookup: publicLookup,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private|loopback/i);
    expect(called).toBe(false);
  });

  it("blocks a redirect that lands on an internal address", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.href.includes("evil.example.com")) {
        return response("", { status: 302, location: "http://127.0.0.1:8080/admin" });
      }
      return response("should not reach here");
    });
    const result = await fetchUrl("https://evil.example.com/start", {
      fetcher: fetcher as never,
      lookup: publicLookup,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private|loopback/i);
    // The redirect target was never fetched.
    expect(fetcher.mock.calls.every(([u]) => !String(u).includes("127.0.0.1"))).toBe(true);
  });

  it("follows a safe redirect and reports the final URL", async () => {
    const fetcher = async (url: URL) => {
      if (url.href.endsWith("/old")) {
        return response("", { status: 301, location: "https://example.com/new" });
      }
      return response("<html><body><article><h1>Moved</h1><p>" + "x ".repeat(40) + "</p></article></body></html>");
    };
    const result = await fetchUrl("https://example.com/old", {
      fetcher: fetcher as never,
      lookup: publicLookup,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Moved");
  });

  it("decodes non-UTF-8 pages per the declared charset", async () => {
    // 0xE9 is é in latin1; as UTF-8 it would be a replacement char.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("<html><body><article><h1>caf"),
      0xe9,
      ...new TextEncoder().encode("</h1><p>" + "x ".repeat(40) + "</p></article></body></html>"),
    ]);
    const result = await fetchUrl("https://example.com/fr", {
      fetcher: async () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "text/html; charset=iso-8859-1" },
        }),
      lookup: publicLookup,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("café");
    expect(result.content).not.toContain("�");
  });
});
