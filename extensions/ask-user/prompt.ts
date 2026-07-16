/** All model-facing text for the ask_user tool. */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;

export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user one multiple-choice question with 2-5 answer options. " +
  "A free-form 'write my own answer' choice is appended automatically — never add one yourself. " +
  "The user may attach a note to the option they select; treat such a note as qualifying or constraining their choice. " +
  "The user may also dismiss the question without answering.";

export const ASK_USER_PROMPT_SNIPPET =
  "Ask the user a multiple-choice question (2-5 options plus an automatic free-form answer).";

export const ASK_USER_PROMPT_GUIDELINES = [
  "When you need input from the user and the plausible answers can be enumerated, call ask_user instead of asking in plain text.",
  "Ask exactly one question per ask_user call; follow-ups go in separate calls.",
  "Make options concrete and mutually exclusive; use the description field for trade-offs, not the label.",
];

export const ASK_USER_PARAMETER_DESCRIPTIONS = {
  question: "The question to ask the user.",
  options: `Between ${MIN_OPTIONS} and ${MAX_OPTIONS} answer options. Do not include a free-form or 'other' option — one is appended automatically.`,
  optionLabel: "Short display label for this option (1-5 words).",
  optionDescription:
    "Optional one-line explanation shown under the label — implications or trade-offs.",
};

export type AskUserOutcome =
  | { kind: "no-ui" }
  | { kind: "cancelled" }
  | { kind: "dismissed" }
  | { kind: "custom"; answer: string }
  | { kind: "selected"; answer: string; index: number; note?: string };

/** Tool-result text telling the model what actually happened. */
export function buildResultMessage(outcome: AskUserOutcome) {
  switch (outcome.kind) {
    case "no-ui":
      return "No interactive UI is available, so the question was not shown. Ask the user in plain text instead.";
    case "cancelled":
      return "Cancelled before the user answered.";
    case "dismissed":
      return "The user dismissed the question without answering. Do not assume any answer; proceed accordingly or rephrase.";
    case "custom":
      return `The user wrote their own answer: ${outcome.answer}`;
    case "selected": {
      const base = `The user selected option ${outcome.index}: ${outcome.answer}`;
      return outcome.note
        ? `${base}\nThey attached a note qualifying this choice: ${outcome.note}`
        : base;
    }
  }
}
