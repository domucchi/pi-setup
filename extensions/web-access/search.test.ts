import { describe, expect, it, vi } from "vitest";
import { exaSearch } from "./src/search.ts";

const EXA_BODY = {
  results: [
    {
      title: "Result One",
      url: "https://a.com",
      publishedDate: "2026-01-02T00:00:00Z",
      highlights: ["snippet one", "snippet two"],
      text: "x".repeat(9000),
    },
    { url: "https://b.com", highlights: [] }, // no title → falls back to url
    { title: "No URL", highlights: [] }, // dropped: no url
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("exaSearch", () => {
  it("returns no-key error without an API key", async () => {
    const outcome = await exaSearch("q", undefined);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("no-key");
  });

  it("sends the query with auth header and parses results", async () => {
    const fetcher = vi.fn(
      async (_url: unknown, _init?: RequestInit) => jsonResponse(EXA_BODY),
    );
    const outcome = await exaSearch("llms", "key-123", { includeText: true }, fetcher as never);

    const init = fetcher.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key-123");
    const sent = JSON.parse(init.body as string);
    expect(sent.query).toBe("llms");
    expect(sent.contents.text).toBeTruthy();

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.results).toHaveLength(2); // "No URL" dropped
      expect(outcome.results[0].highlights).toEqual(["snippet one", "snippet two"]);
      expect(outcome.results[0].text!.length).toBeLessThanOrEqual(4000); // capped
      expect(outcome.results[1].title).toBe("https://b.com"); // url fallback
    }
  });

  it("omits text when include_text is off", async () => {
    const fetcher = vi.fn(
      async (_url: unknown, _init?: RequestInit) => jsonResponse({ results: [] }),
    );
    await exaSearch("q", "key", { includeText: false }, fetcher as never);
    const sent = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(sent.contents.text).toBeUndefined();
    expect(sent.contents.highlights).toBe(true);
  });

  it("maps auth, rate-limit, and http errors", async () => {
    const auth = await exaSearch("q", "k", {}, (async () => jsonResponse({}, 401)) as never);
    expect(auth.ok === false && auth.error.kind).toBe("auth");
    const rate = await exaSearch("q", "k", {}, (async () => jsonResponse({}, 429)) as never);
    expect(rate.ok === false && rate.error.kind).toBe("rate-limit");
    const http = await exaSearch("q", "k", {}, (async () => jsonResponse({}, 500)) as never);
    expect(http.ok === false && http.error.kind).toBe("http");
  });

  it("maps network failures without throwing", async () => {
    const outcome = await exaSearch("q", "k", {}, (async () => {
      throw new Error("dns fail");
    }) as never);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("network");
  });
});
