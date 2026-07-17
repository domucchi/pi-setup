/** Pure logic for session-title generation (testable). */

export const TITLE_SYSTEM_PROMPT = [
  "You name coding sessions.",
  "Given the first user message of a session, output a short title:",
  "2-4 words, at most 40 characters, the first word starts with uppercase.",
  "Name the TASK, not the tool (e.g. \"fix flaky watchdog test\", not \"coding help\").",
  "Output ONLY the title — no quotes, no punctuation at the end, no explanation.",
].join("\n");

const MAX_INPUT_CHARS = 600;
export const MAX_TITLE_CHARS = 48;

/** First user message, clipped — enough signal to name the task. */
export function buildTitleInput(text: string): string {
  const clipped = text.trim().slice(0, MAX_INPUT_CHARS);
  return `Name this session. First user message:\n\n${clipped}`;
}

/**
 * Normalize model output into a usable title, or undefined when it is
 * unusable (empty, refusal-length, multi-sentence rambling).
 */
export function sanitizeTitle(raw: string): string | undefined {
  let title = (raw ?? "").trim().split("\n")[0].trim();
  title = title.replace(/^["'`“”]+|["'`“”.]+$/g, "").replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  if (title.length > MAX_TITLE_CHARS) {
    const cut = title.slice(0, MAX_TITLE_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return title || undefined;
}

/** Inputs that should not trigger naming (commands, bash, empty). */
export function isTitleWorthy(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  return !trimmed.startsWith("/") && !trimmed.startsWith("!");
}
