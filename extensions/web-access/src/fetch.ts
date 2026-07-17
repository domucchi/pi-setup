import { decodeBody } from "./charset.ts";
import { extractFromHtml, isHtmlContentType } from "./extract.ts";
import { assertPublicUrl, SsrfError, type Lookup } from "./ssrf.ts";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; pi-web-access/1.0; +https://pi.dev)";

export interface FetchResult {
  ok: boolean;
  url: string;
  /** Final URL after redirects (differs from url when redirected). */
  finalUrl?: string;
  title: string | null;
  contentType: string | null;
  /** Markdown (HTML pages) or raw text (other text types). */
  content: string;
  error?: string;
}

export type Fetcher = typeof fetch;

function isTextContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  return /^(text\/|application\/(json|xml|.*\+xml|.*\+json|javascript|x-yaml|yaml))/i.test(
    contentType,
  );
}

/**
 * Fetch a URL and return readable content: markdown for HTML, raw text
 * for other text types, a clear error for binary/unsupported types.
 * Redirects are followed manually (bounded) so each hop is SSRF-checked —
 * `redirect: "follow"` would let a public URL bounce to an internal one.
 * Never throws.
 */
export async function fetchUrl(
  rawUrl: string,
  deps: { fetcher?: Fetcher; lookup?: Lookup; signal?: AbortSignal } = {},
): Promise<FetchResult> {
  const fetcher = deps.fetcher ?? fetch;

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return errorResult(rawUrl, "Invalid URL.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Tool-execution abort cancels the network work too. Named listener so
  // it can be removed — a shared signal must not accumulate listeners.
  const onAbort = () => controller.abort();
  if (deps.signal?.aborted) controller.abort();
  else deps.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        return errorResult(current.href, "Only http and https URLs are supported.");
      }
      try {
        await assertPublicUrl(current, deps.lookup);
      } catch (error) {
        if (error instanceof SsrfError) return errorResult(current.href, error.message);
        throw error;
      }

      const response = await fetcher(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      });

      // Manual redirect handling: re-check every hop against the SSRF guard.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return errorResult(current.href, `HTTP ${response.status} with no Location header.`);
        }
        try {
          current = new URL(location, current);
        } catch {
          return errorResult(current.href, `Invalid redirect target "${location}".`);
        }
        continue;
      }

      if (!response.ok) {
        return errorResult(current.href, `HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type");
      if (!isTextContentType(contentType)) {
        return errorResult(
          current.href,
          `Unsupported content type "${contentType ?? "unknown"}" — this tool reads text and HTML pages, not binary files.`,
        );
      }

      const bytes = await readCapped(response);
      const finalUrl = response.url || current.href;
      if (isHtmlContentType(contentType)) {
        const { title, markdown } = extractFromHtml(decodeBody(bytes, contentType), finalUrl);
        return {
          ok: true,
          url: rawUrl,
          finalUrl,
          title,
          contentType,
          content: markdown || "(no readable content extracted)",
        };
      }
      return {
        ok: true,
        url: rawUrl,
        finalUrl,
        title: null,
        contentType,
        content: decodeBody(bytes, contentType),
      };
    }
    return errorResult(rawUrl, `Too many redirects (>${MAX_REDIRECTS}).`);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : String(error);
    return errorResult(current.href, message);
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onAbort);
  }
}

/** Read the body into a byte buffer, stopping once past the budget. */
async function readCapped(response: Response): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_RESPONSE_BYTES - bytes;
    if (value.byteLength >= remaining) {
      chunks.push(value.subarray(0, remaining));
      await reader.cancel().catch(() => {});
      bytes += remaining;
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const out = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function errorResult(url: string, error: string): FetchResult {
  return { ok: false, url, title: null, contentType: null, content: "", error };
}
