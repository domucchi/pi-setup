/**
 * web-access — web_search (Exa) and web_fetch (keyless, local extraction).
 *
 * Provider-native web tools (Anthropic/OpenAI) are server-side and not
 * passed through by pi, so both tools execute locally. web_fetch needs no
 * key; web_search reads EXA_API_KEY and degrades to a clear hint when it
 * is absent — fetch keeps working either way.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  previewOf,
  renderCompactResult,
  resultText,
} from "../shared/compact-result.ts";
import { readEnvValue } from "../shared/env.ts";
import {
  buildFetchResult,
  buildSearchResult,
  PARAMETER_DESCRIPTIONS,
  searchErrorMessage,
  WEB_FETCH_DESCRIPTION,
  WEB_FETCH_GUIDELINES,
  WEB_FETCH_SNIPPET,
  WEB_SEARCH_DESCRIPTION,
  WEB_SEARCH_GUIDELINES,
  WEB_SEARCH_SNIPPET,
} from "./prompt.ts";
import { fetchUrl } from "./src/fetch.ts";
import { exaSearch } from "./src/search.ts";

export default function webAccess(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: WEB_SEARCH_DESCRIPTION,
    promptSnippet: WEB_SEARCH_SNIPPET,
    promptGuidelines: WEB_SEARCH_GUIDELINES,
    parameters: Type.Object({
      query: Type.String({ description: PARAMETER_DESCRIPTIONS.query }),
      num_results: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 25,
          description: PARAMETER_DESCRIPTIONS.numResults,
        }),
      ),
      include_text: Type.Optional(
        Type.Boolean({ description: PARAMETER_DESCRIPTIONS.includeText }),
      ),
    }),
    async execute(_id, params) {
      const outcome = await exaSearch(params.query, readEnvValue("EXA_API_KEY"), {
        numResults: params.num_results,
        includeText: params.include_text,
      });
      if (!outcome.ok) {
        throw new Error(searchErrorMessage(outcome.error));
      }
      return {
        content: [
          {
            type: "text" as const,
            text: buildSearchResult(params.query, outcome.results),
          },
        ],
        details: { query: params.query, count: outcome.results.length },
      };
    },
    // Result blocks matter to the model; the human gets count + titles.
    renderResult(result, options, theme) {
      const details = result.details as { query?: string; count?: number } | undefined;
      const count = details?.count ?? 0;
      const text = resultText(result);
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        summary:
          count === 0
            ? `no results · ${details?.query ?? ""}`
            : `→ ${count} result${count === 1 ? "" : "s"} · ${details?.query ?? ""}`,
        fullText: text,
        previewLines: count > 0 ? previewOf(text, 3, 1) : undefined,
      });
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: WEB_FETCH_DESCRIPTION,
    promptSnippet: WEB_FETCH_SNIPPET,
    promptGuidelines: WEB_FETCH_GUIDELINES,
    parameters: Type.Object({
      url: Type.String({ description: PARAMETER_DESCRIPTIONS.url }),
    }),
    async execute(_id, params) {
      const result = await fetchUrl(params.url);
      return {
        content: [{ type: "text" as const, text: buildFetchResult(result) }],
        details: { url: result.url, ok: result.ok },
      };
    },
    // A fetched page is pure model food — the human gets one status line.
    renderResult(result, options, theme) {
      const details = result.details as { url?: string; ok?: boolean } | undefined;
      const text = resultText(result);
      const chars = text.length;
      return renderCompactResult({
        theme,
        expanded: options.expanded,
        isError: details?.ok === false,
        summary: `→ fetched ${details?.url ?? ""} · ${chars > 1_000 ? `${Math.round(chars / 1_000)}k` : chars} chars`,
        fullText: text,
      });
    },
  });
}
