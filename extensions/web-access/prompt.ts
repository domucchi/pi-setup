/** All model-facing text for the web-access tools. */

import type { FetchResult } from "./src/fetch.ts";
import type { SearchProviderError, SearchResult } from "./src/search.ts";

export const WEB_SEARCH_DESCRIPTION =
  "Search the web and get relevant results with title, URL, and query-focused snippets. " +
  "Set include_text to also pull page content inline (fewer follow-up fetches). " +
  "Requires an Exa API key in EXA_API_KEY.";

export const WEB_SEARCH_SNIPPET =
  "Search the web for current information (results with snippets).";

export const WEB_SEARCH_GUIDELINES = [
  "Use web_search for current or external information beyond your knowledge, then web_fetch a result URL when you need its full content.",
  "Prefer include_text for research questions so results arrive with content; leave it off when you only need to find URLs.",
];

export const WEB_FETCH_DESCRIPTION =
  "Fetch a URL and return its readable content as markdown (HTML pages) or text. " +
  "Use for documentation, articles, and pages whose URL you already know. Does not run JavaScript or read binary files.";

export const WEB_FETCH_SNIPPET =
  "Fetch a URL and read its content as markdown.";

export const WEB_FETCH_GUIDELINES = [
  "Use web_fetch to read a specific known URL; use web_search to discover URLs first.",
  "Long pages are truncated; the note tells you when output was cut.",
];

export const PARAMETER_DESCRIPTIONS = {
  query: "The search query.",
  numResults: "How many results to return (1-25, default 8).",
  includeText: "Also return page content inline with each result.",
  url: "The http(s) URL to fetch.",
};

export function searchErrorMessage(error: SearchProviderError): string {
  switch (error.kind) {
    case "no-key":
      return "Web search is unavailable: set EXA_API_KEY to enable it. web_fetch still works for known URLs.";
    case "auth":
      return "Exa rejected the API key (check EXA_API_KEY).";
    case "rate-limit":
      return "Exa rate limit hit — wait a moment and retry, or reduce searches.";
    case "http":
      return `Exa search failed (HTTP ${error.status})${error.message ? `: ${error.message}` : ""}.`;
    case "network":
      return `Could not reach Exa: ${error.message}`;
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function buildSearchResult(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No results for "${query}".`;
  const blocks = results.map((r, i) => {
    const lines = [`${i + 1}. ${r.title}`, `   ${r.url}`];
    if (r.publishedDate) lines.push(`   published: ${r.publishedDate.slice(0, 10)}`);
    for (const highlight of r.highlights.slice(0, 3)) {
      lines.push(`   > ${clip(highlight.replace(/\s+/g, " ").trim(), 300)}`);
    }
    if (r.text) {
      lines.push("", clip(r.text, 2_000));
    }
    return lines.join("\n");
  });
  return `Results for "${query}":\n\n${blocks.join("\n\n")}`;
}

const MAX_FETCH_OUTPUT = 40_000;

export function buildFetchResult(result: FetchResult): string {
  if (!result.ok) {
    return `Could not fetch ${result.url}: ${result.error}`;
  }
  const header = result.title ? `# ${result.title}\n${result.url}` : result.url;
  let body = result.content;
  let note = "";
  if (body.length > MAX_FETCH_OUTPUT) {
    body = body.slice(0, MAX_FETCH_OUTPUT);
    note = `\n\n[content truncated at ${MAX_FETCH_OUTPUT} chars]`;
  }
  return `${header}\n\n${body}${note}`;
}
