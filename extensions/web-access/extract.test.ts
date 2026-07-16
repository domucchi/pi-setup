import { describe, expect, it } from "vitest";
import { extractFromHtml, isHtmlContentType } from "./src/extract.ts";

describe("extractFromHtml", () => {
  it("pulls the article title and body as markdown", () => {
    const html = `<!doctype html><html><head><title>Ignored Tab Title</title></head>
      <body><article>
        <h1>Real Heading</h1>
        <p>First paragraph with <a href="https://x.com">a link</a>.</p>
        <p>Second paragraph of enough length to be considered article content by the readability heuristics used here.</p>
      </article></body></html>`;
    const { title, markdown } = extractFromHtml(html, "https://x.com/post");
    expect(markdown).toContain("Real Heading");
    expect(markdown).toContain("First paragraph");
    expect(markdown).toContain("[a link](https://x.com/)");
    expect(title).toBeTruthy();
  });

  it("resolves relative links against the base URL", () => {
    const html = `<html><body><article><h1>Docs</h1>
      <p>See <a href="/guide/intro">the intro</a> and this ${"padding ".repeat(20)}.</p>
      </article></body></html>`;
    const { markdown } = extractFromHtml(html, "https://docs.example.com/v2/page");
    expect(markdown).toContain("https://docs.example.com/guide/intro");
  });

  it("strips scripts and styles", () => {
    const html = `<html><body><article><h1>T</h1>
      <script>alert('x')</script><style>.a{}</style>
      <p>Visible content that is long enough to be extracted as the main article body text here.</p>
      </article></body></html>`;
    const { markdown } = extractFromHtml(html);
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain(".a{}");
    expect(markdown).toContain("Visible content");
  });

  it("falls back to raw text when there is no article", () => {
    const html = `<html><head><title>Bare</title></head><body><div>just a bit of text</div></body></html>`;
    const { markdown } = extractFromHtml(html);
    expect(markdown).toContain("just a bit of text");
  });

  it("never throws on malformed input", () => {
    expect(() => extractFromHtml("<not really html")).not.toThrow();
    expect(extractFromHtml("").markdown).toBe("");
  });
});

describe("isHtmlContentType", () => {
  it("treats html and missing types as html", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType(null)).toBe(true);
    expect(isHtmlContentType("application/json")).toBe(false);
  });
});
