/**
 * session-title — name the session from its first real prompt using a
 * cheap model (gpt-5.6-luna), so terminal tabs and /resume are
 * distinguishable at a glance.
 *
 * The name goes through pi's native mechanism: sessionManager.
 * appendSessionInfo() persists it to the session file and fires
 * session_info_changed, which makes pi itself retitle the terminal to
 * "π - {name} - {folder}" and show the name in /resume. The generation
 * runs on a tools-stripped in-memory child session (same auth path as
 * subagents), fire-and-forget — a failure just leaves the default title.
 */

import { basename } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createChild, type RunOutcome } from "../subagents/src/child.ts";
import {
  buildTitleInput,
  isTitleWorthy,
  sanitizeTitle,
  TITLE_SYSTEM_PROMPT,
} from "./src/title.ts";

const TITLE_MODEL_PROVIDER = "openai-codex";
const TITLE_MODEL_ID = "gpt-5.6-luna";
const MAX_ATTEMPTS = 2;
const GENERATION_TIMEOUT_MS = 60_000;

export default function sessionTitle(pi: ExtensionAPI) {
  let titled = false;
  let generating = false;
  let attempts = 0;
  let session = 0; // guards delayed re-asserts across session switches
  let sessionName: string | undefined;
  let working = false;

  // Tab title = state glyph + topic (π when settled, ◆ while the agent
  // works — the terminal tab has no icon API, so the glyph IS the icon).
  // Core rebuilds "π - {name} - {folder}" on session_info_changed and
  // session switches, so set ours after it and re-assert shortly after.
  const applyTitle = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    const name = sessionName ?? basename(ctx.cwd);
    const title = `${working ? "◆" : "π"} ${name}`;
    const current = session;
    ctx.ui.setTitle(title);
    setTimeout(() => {
      if (session === current) ctx.ui.setTitle(title);
    }, 250).unref?.();
  };

  pi.on("session_start", (_event, ctx) => {
    session += 1;
    // A resumed session keeps its earlier name; don't rename it.
    sessionName = ctx.sessionManager.getSessionName() || undefined;
    titled = Boolean(sessionName);
    working = false;
    generating = false;
    attempts = 0;
    applyTitle(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    working = true;
    applyTitle(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    working = false;
    applyTitle(ctx);
  });

  async function generate(ctx: ExtensionContext, text: string) {
    const registry = ctx.modelRegistry;
    const model =
      registry.find(TITLE_MODEL_PROVIDER, TITLE_MODEL_ID) ??
      registry.getAll().find((m) => m.id === TITLE_MODEL_ID);
    if (!model) {
      titled = true; // No cheap model available — stop trying.
      return;
    }

    const settled = new Promise<RunOutcome>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      void createChild({
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
        modelRegistry: registry,
        model,
        thinkingLevel: "minimal",
        allowTools: [], // no tools: keeps the request tiny and read-only
        appendSystemPrompt: TITLE_SYSTEM_PROMPT,
        inMemorySession: true,
        sessionName: "session-title",
        onEvent: (event) => {
          if (event.type === "run-settled") {
            if (timer) clearTimeout(timer);
            resolve(event.outcome);
          }
        },
      }).then(
        (child) => {
          timer = setTimeout(() => {
            void child.dispose();
            resolve({ kind: "failed", errorText: "title generation timed out" });
          }, GENERATION_TIMEOUT_MS);
          timer.unref?.();
          settled.finally(() => void child.dispose().catch(() => {}));
          child.prompt(buildTitleInput(text));
        },
        (error) =>
          resolve({
            kind: "failed",
            errorText: error instanceof Error ? error.message : String(error),
          }),
      );
    });

    const outcome = await settled;
    if (outcome.kind !== "completed") return;
    const title = sanitizeTitle(outcome.finalText);
    if (!title) return;
    // ReadonlySessionManager type hides the writer, but ctx holds the
    // real SessionManager — naming a session is exactly what this is for.
    // This also labels the session in /resume; the terminal tab itself
    // gets the glyph + topic via applyTitle below.
    (ctx.sessionManager as SessionManager).appendSessionInfo(title);
    sessionName = title;
    titled = true;
    applyTitle(ctx);
  }

  pi.on("input", (event, ctx) => {
    // Titles only matter where there's a tab to name.
    if (ctx.mode !== "tui") return;
    if (titled || generating || attempts >= MAX_ATTEMPTS) return;
    if (!isTitleWorthy(event.text)) return;
    generating = true;
    attempts += 1;
    void generate(ctx, event.text)
      .catch(() => {})
      .finally(() => {
        generating = false;
      });
  });
}
