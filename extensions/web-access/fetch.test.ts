import { describe, expect, it } from "vitest";
import { fetchUrl } from "./src/fetch.ts";

function response(
  body: string,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/html" },
  });
}

describe("fetchUrl", () => {
  it("returns markdown for an HTML page", async () => {
    const html = `<html><head><title>Doc</title></head><body><article><h1>Guide</h1><p>${"content ".repeat(30)}</p></article></body></html>`;
    const result = await fetchUrl("https://example.com/doc", {
      fetcher: async () => response(html),
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Guide");
  });

  it("returns raw text for non-HTML text types", async () => {
    const result = await fetchUrl("https://example.com/data.json", {
      fetcher: async () => response('{"a":1}', { contentType: "application/json" }),
    });
    expect(result.ok).toBe(true);
    expect(result.content).toBe('{"a":1}');
  });

  it("rejects binary content types with a clear error", async () => {
    const result = await fetchUrl("https://example.com/file.pdf", {
      fetcher: async () => response("%PDF-1.4", { contentType: "application/pdf" }),
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
    expect((await fetchUrl("file:///etc/passwd", { fetcher })).ok).toBe(false);
    expect((await fetchUrl("not a url", { fetcher })).ok).toBe(false);
    expect(called).toBe(false);
  });

  it("surfaces HTTP errors", async () => {
    const result = await fetchUrl("https://example.com/missing", {
      fetcher: async () => response("nope", { status: 404 }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
  });

  it("never throws when the fetcher rejects", async () => {
    const result = await fetchUrl("https://example.com", {
      fetcher: async () => {
        throw new Error("connection refused");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("connection refused");
  });
});
