const EXA_ENDPOINT = "https://api.exa.ai/search";
const SEARCH_TIMEOUT_MS = 20_000;

export interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  /** Relevant snippets Exa extracts for the query. */
  highlights: string[];
  /** Full page text, capped; present when the model asked for content. */
  text?: string;
}

export type SearchProviderError =
  | { kind: "no-key" }
  | { kind: "auth" }
  | { kind: "rate-limit" }
  | { kind: "http"; status: number; message: string }
  | { kind: "network"; message: string };

export type SearchOutcome =
  | { ok: true; results: SearchResult[] }
  | { ok: false; error: SearchProviderError };

export interface SearchOptions {
  numResults?: number;
  includeText?: boolean;
  /** Tool-execution abort: cancels the request when it fires. */
  signal?: AbortSignal;
}

const MAX_TEXT_CHARS = 4_000;

function normalize(raw: unknown, includeText: boolean): SearchResult[] {
  const results = (raw as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results.map((item) => {
    const record = item as Record<string, unknown>;
    const highlights = Array.isArray(record.highlights)
      ? record.highlights.filter((h): h is string => typeof h === "string")
      : [];
    const text =
      includeText && typeof record.text === "string"
        ? record.text.slice(0, MAX_TEXT_CHARS)
        : undefined;
    return {
      title: typeof record.title === "string" ? record.title : record.url as string,
      url: typeof record.url === "string" ? record.url : "",
      publishedDate:
        typeof record.publishedDate === "string" ? record.publishedDate : undefined,
      highlights,
      text,
    };
  }).filter((r) => r.url);
}

/**
 * Query Exa. Pure over an injectable fetch so it can be unit-tested
 * without network. Never throws — failures come back as a typed error.
 */
export async function exaSearch(
  query: string,
  apiKey: string | undefined,
  options: SearchOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<SearchOutcome> {
  if (!apiKey) return { ok: false, error: { kind: "no-key" } };

  const includeText = options.includeText ?? false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  if (options.signal?.aborted) controller.abort();
  else {
    options.signal?.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }
  try {
    const response = await fetcher(EXA_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: Math.min(Math.max(options.numResults ?? 8, 1), 25),
        contents: {
          highlights: true,
          ...(includeText ? { text: { maxCharacters: MAX_TEXT_CHARS } } : {}),
        },
      }),
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: { kind: "auth" } };
    }
    if (response.status === 429) {
      return { ok: false, error: { kind: "rate-limit" } };
    }
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      return {
        ok: false,
        error: { kind: "http", status: response.status, message: message.slice(0, 500) },
      };
    }

    const raw = await response.json();
    return { ok: true, results: normalize(raw, includeText) };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Timed out after ${SEARCH_TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, error: { kind: "network", message } };
  } finally {
    clearTimeout(timer);
  }
}
