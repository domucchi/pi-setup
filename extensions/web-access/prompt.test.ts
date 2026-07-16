import { describe, expect, it } from "vitest";
import {
  buildFetchResult,
  buildSearchResult,
  searchErrorMessage,
} from "./prompt.ts";
import type { FetchResult } from "./src/fetch.ts";
import type { SearchResult } from "./src/search.ts";

describe("buildSearchResult", () => {
  it("reports no results", () => {
    expect(buildSearchResult("q", [])).toContain('No results for "q"');
  });

  it("numbers results with url, date, and clipped highlights", () => {
    const results: SearchResult[] = [
      {
        title: "First",
        url: "https://a.com",
        publishedDate: "2026-02-03T10:00:00Z",
        highlights: ["  a  snippet  ", "b"],
      },
    ];
    const text = buildSearchResult("q", results);
    expect(text).toContain("1. First");
    expect(text).toContain("https://a.com");
    expect(text).toContain("published: 2026-02-03");
    expect(text).toContain("> a snippet");
  });

  it("includes full page text when present", () => {
    const results: SearchResult[] = [
      { title: "T", url: "https://a.com", highlights: [], text: "full body text" },
    ];
    expect(buildSearchResult("q", results)).toContain("full body text");
  });
});

describe("buildFetchResult", () => {
  const base: FetchResult = {
    ok: true,
    url: "https://a.com",
    title: "Title",
    contentType: "text/html",
    content: "body",
  };

  it("renders title, url, and content", () => {
    const text = buildFetchResult(base);
    expect(text).toContain("# Title");
    expect(text).toContain("https://a.com");
    expect(text).toContain("body");
  });

  it("truncates long content with a note", () => {
    const text = buildFetchResult({ ...base, content: "x".repeat(50_000) });
    expect(text).toContain("[content truncated");
    expect(text.length).toBeLessThan(50_000);
  });

  it("reports fetch errors", () => {
    const text = buildFetchResult({
      ok: false,
      url: "https://a.com",
      title: null,
      contentType: null,
      content: "",
      error: "HTTP 500",
    });
    expect(text).toContain("Could not fetch");
    expect(text).toContain("HTTP 500");
  });
});

describe("searchErrorMessage", () => {
  it("maps each provider error kind to a distinct message", () => {
    expect(searchErrorMessage({ kind: "no-key" })).toContain("EXA_API_KEY");
    expect(searchErrorMessage({ kind: "auth" })).toContain("key");
    expect(searchErrorMessage({ kind: "rate-limit" })).toContain("rate limit");
    expect(searchErrorMessage({ kind: "http", status: 500, message: "x" })).toContain("500");
    expect(searchErrorMessage({ kind: "network", message: "dns" })).toContain("dns");
  });
});
