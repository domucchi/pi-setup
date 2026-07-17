/** Pure state logic for the multi-question ask_user form (testable). */

export interface FormOption {
  label: string;
  description?: string;
}

export interface FormQuestion {
  question: string;
  header?: string;
  options: FormOption[];
  multiSelect: boolean;
}

/** One question's in-progress answer. Custom text is exclusive. */
export interface AnswerState {
  selected: number[];
  custom?: string;
  note?: string;
}

export function emptyAnswers(count: number): AnswerState[] {
  return Array.from({ length: count }, () => ({ selected: [] }));
}

export function isAnswered(answer: AnswerState): boolean {
  return answer.custom !== undefined || answer.selected.length > 0;
}

export function allAnswered(answers: AnswerState[]): boolean {
  return answers.every(isAnswered);
}

/** Short tab label: explicit header or Q1/Q2/… */
export function tabLabel(question: FormQuestion, index: number): string {
  return question.header?.trim() || `Q${index + 1}`;
}

/**
 * Where to go after answering the question at `from`: the next
 * unanswered question (wrapping), or `answers.length` (the submit tab)
 * when everything is answered.
 */
export function nextTarget(answers: AnswerState[], from: number): number {
  for (let step = 1; step <= answers.length; step++) {
    const index = (from + step) % answers.length;
    if (!isAnswered(answers[index])) return index;
  }
  return answers.length;
}

/** First unanswered question, or undefined when the form is complete. */
export function firstUnanswered(answers: AnswerState[]): number | undefined {
  const index = answers.findIndex((a) => !isAnswered(a));
  return index === -1 ? undefined : index;
}

/** Toggle an option in a multi-select answer (clears any custom text). */
export function toggleSelection(answer: AnswerState, option: number): AnswerState {
  const selected = answer.selected.includes(option)
    ? answer.selected.filter((i) => i !== option)
    : [...answer.selected, option].sort((a, b) => a - b);
  return { ...answer, custom: undefined, selected };
}

/** The display/answer texts for a question's final answer. */
export function answerTexts(question: FormQuestion, answer: AnswerState): string[] {
  if (answer.custom !== undefined) return [answer.custom];
  return answer.selected.map((i) => question.options[i]?.label ?? `option ${i + 1}`);
}
