/** All model-facing text for the ask_user tool. */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;
export const MAX_QUESTIONS = 5;

export const ASK_USER_TOOL_DESCRIPTION =
  `Ask the user 1-${MAX_QUESTIONS} multiple-choice questions in one compact form. ` +
  "Each question has 2-5 answer options; a free-form 'write my own answer' choice is " +
  "appended automatically — never add one yourself. Questions may be single-select " +
  "(default) or multi-select (multi_select: true). " +
  "Batch INDEPENDENT questions into one call to reduce interruptions; if a later " +
  "question depends on an earlier answer, ask it in a separate call instead. " +
  "The user may attach a note to a selected option; treat it as qualifying their choice. " +
  "The user may also dismiss the whole form without answering.";

export const ASK_USER_PROMPT_SNIPPET =
  "Ask the user multiple-choice questions (1-5 per call, single/multi-select, plus an automatic free-form answer).";

export const ASK_USER_PROMPT_GUIDELINES = [
  "When you need input from the user and the plausible answers can be enumerated, call ask_user instead of asking in plain text.",
  "Batch independent questions into ONE ask_user call (up to 5); use separate calls only when a question depends on a previous answer.",
  "Make options concrete and mutually exclusive; use the description field for trade-offs, not the label. Use multi_select when several options can apply at once.",
];

export const ASK_USER_PARAMETER_DESCRIPTIONS = {
  questions: `1-${MAX_QUESTIONS} questions shown as one form. Batch independent questions; dependent follow-ups go in later calls.`,
  question: "The question to ask the user.",
  header:
    "Very short tab label for this question (1-2 words, e.g. 'Auth', 'Scope'). Defaults to Q1/Q2/…",
  options: `Between ${MIN_OPTIONS} and ${MAX_OPTIONS} answer options. Do not include a free-form or 'other' option — one is appended automatically.`,
  optionLabel: "Short display label for this option (1-5 words).",
  optionDescription:
    "Optional one-line explanation shown under the label — implications or trade-offs.",
  multiSelect:
    "Allow selecting several options (space toggles, enter confirms). Default false.",
};

export interface QuestionResult {
  question: string;
  /** Selected option labels, or the single free-form answer. */
  answers: string[];
  wasCustom: boolean;
  note?: string;
}

export type AskUserOutcome =
  | { kind: "no-ui" }
  | { kind: "cancelled" }
  | { kind: "dismissed" }
  | { kind: "answered"; results: QuestionResult[] };

function formatAnswer(result: QuestionResult) {
  const base = result.wasCustom
    ? `(wrote) ${result.answers[0] ?? ""}`
    : result.answers.join(", ");
  return result.note ? `${base} — note: ${result.note}` : base;
}

function formatSingle(result: QuestionResult) {
  const base = result.wasCustom
    ? `The user wrote their own answer: ${result.answers[0] ?? ""}`
    : `The user selected: ${result.answers.join(", ")}`;
  return result.note
    ? `${base}\nThey attached a note qualifying this choice: ${result.note}`
    : base;
}

/** Tool-result text telling the model what actually happened. */
export function buildResultMessage(outcome: AskUserOutcome) {
  switch (outcome.kind) {
    case "no-ui":
      return "No interactive UI is available, so the questions were not shown. Ask the user in plain text instead.";
    case "cancelled":
      return "Cancelled before the user answered.";
    case "dismissed":
      return "The user dismissed the questions without answering. Do not assume any answers; proceed accordingly or rephrase.";
    case "answered": {
      if (outcome.results.length === 1) return formatSingle(outcome.results[0]);
      return [
        "The user answered:",
        ...outcome.results.map(
          (result, i) =>
            `${i + 1}. ${result.question}\n   → ${formatAnswer(result)}`,
        ),
      ].join("\n");
    }
  }
}
