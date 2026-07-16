import { extractFromHtml, isHtmlContentType } from "./extract.ts";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; pi-web-access/1.0; +https://pi.dev)";

export interface FetchResult {
  ok: boolean;
  url: string;
  title: string | null;
  contentType: string | null;
  /** Markdown (HTML pages) or raw text (other text types). */
  content: string;
  error?: string;
}

/** Injectable for tests; defaults to global fetch. */
export type Fetcher = typeof fetch;

function isTextContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  return /^(text\/|application\/(json|xml|.*\+xml|.*\+json|javascript|x-yaml|yaml))/i.test(
    contentType,
  );
}

/**
 * Fetch a URL and return readable content: markdown for HTML, raw text
 * for other text types, and a clear error for binary/unsupported types
 * (e.g. PDFs) rather than dumping bytes. Never throws.
 */
export async function fetchUrl(
  rawUrl: string,
  deps: { fetcher?: Fetcher } = {},
): Promise<FetchResult> {
  const fetcher = deps.fetcher ?? fetch;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return errorResult(rawUrl, "Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return errorResult(rawUrl, "Only http and https URLs are supported.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
    });
    if (!response.ok) {
      return errorResult(url.href, `HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (!isTextContentType(contentType)) {
      return errorResult(
        url.href,
        `Unsupported content type "${contentType ?? "unknown"}" — this tool reads text and HTML pages, not binary files.`,
      );
    }

    const raw = await readCapped(response);
    if (isHtmlContentType(contentType)) {
      const { title, markdown } = extractFromHtml(raw, url.href);
      return {
        ok: true,
        url: url.href,
        title,
        contentType,
        content: markdown || "(no readable content extracted)",
      };
    }
    return { ok: true, url: url.href, title: null, contentType, content: raw };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : String(error);
    return errorResult(url.href, message);
  } finally {
    clearTimeout(timer);
  }
}

/** Read the body but stop once we pass the byte budget. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return await response.text();
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return text;
}

function errorResult(url: string, error: string): FetchResult {
  return { ok: false, url, title: null, contentType: null, content: "", error };
}
