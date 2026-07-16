import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
// Drop noise that survives Readability or appears in the raw fallback.
// (svg lives in SVGElementTagNameMap, not the HTML map Turndown types
// accept, and is already stripped in the raw-text path.)
turndown.remove(["script", "style", "noscript", "iframe"]);

export interface Extracted {
  title: string | null;
  markdown: string;
}

/** Crude fallback: strip tags to text when Readability finds no article. */
function rawText(html: string): string {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script, style, noscript, svg")) {
    el.remove();
  }
  return (document.body?.textContent ?? document.textContent ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract readable content from an HTML string as markdown. Tries
 * Readability (article view) first, falls back to a tag-stripped text
 * dump. Never throws — a parse failure yields an empty markdown string.
 */
/** Rewrite relative href/src to absolute so links survive extraction. */
function absolutizeLinks(document: ReturnType<typeof parseHTML>["document"], base: string) {
  for (const [selector, attr] of [
    ["a[href]", "href"],
    ["img[src]", "src"],
  ] as const) {
    for (const el of document.querySelectorAll(selector)) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      try {
        el.setAttribute(attr, new URL(value, base).href);
      } catch {
        // Leave unresolvable values as-is.
      }
    }
  }
}

export function extractFromHtml(html: string, url?: string): Extracted {
  try {
    const { document } = parseHTML(html);
    if (url) absolutizeLinks(document, url);
    const reader = new Readability(document as never);
    const article = reader.parse();
    if (article?.content) {
      const markdown = turndown.turndown(article.content).trim();
      if (markdown) {
        return { title: article.title?.trim() || null, markdown };
      }
    }
    // Readability found nothing usable — fall back to raw text.
    const { document: titleDoc } = parseHTML(html);
    const title = titleDoc.querySelector("title")?.textContent?.trim() || null;
    return { title, markdown: rawText(html) };
  } catch {
    try {
      return { title: null, markdown: rawText(html) };
    } catch {
      return { title: null, markdown: "" };
    }
  }
}

/** True for content types we should parse as HTML rather than pass through. */
export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return true; // assume HTML when unspecified
  return /\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}
