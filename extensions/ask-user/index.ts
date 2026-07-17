/**
 * ask_user — the model asks 1-5 multiple-choice questions in one popup
 * form (Claude Code-style).
 *
 * Multi-question forms get a tab bar (← Q tabs · ✓ Submit →): answering
 * a single-select question auto-advances to the next unanswered one,
 * multi-select questions toggle with space/enter, and the Submit tab
 * reviews everything before finishing. Every question also gets an
 * appended "Write my own answer…" entry (inline editor), and Tab
 * attaches a note to the current answer. Esc dismisses the whole form —
 * reported to the model as a decline, never as an answer.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  ASK_USER_PARAMETER_DESCRIPTIONS,
  ASK_USER_PROMPT_GUIDELINES,
  ASK_USER_PROMPT_SNIPPET,
  ASK_USER_TOOL_DESCRIPTION,
  buildResultMessage,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  type AskUserOutcome,
  type QuestionResult,
} from "./prompt.ts";
import {
  allAnswered,
  answerTexts,
  emptyAnswers,
  firstUnanswered,
  isAnswered,
  nextTarget,
  tabLabel,
  toggleSelection,
  type AnswerState,
  type FormQuestion,
} from "./src/form.ts";
import { wrapText } from "./src/wrap.ts";

const OptionSchema = Type.Object({
  label: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.optionLabel,
  }),
  description: Type.Optional(
    Type.String({
      description: ASK_USER_PARAMETER_DESCRIPTIONS.optionDescription,
    }),
  ),
});

const AskUserParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String({
        description: ASK_USER_PARAMETER_DESCRIPTIONS.question,
      }),
      header: Type.Optional(
        Type.String({ description: ASK_USER_PARAMETER_DESCRIPTIONS.header }),
      ),
      options: Type.Array(OptionSchema, {
        minItems: MIN_OPTIONS,
        maxItems: MAX_OPTIONS,
        description: ASK_USER_PARAMETER_DESCRIPTIONS.options,
      }),
      multi_select: Type.Optional(
        Type.Boolean({
          description: ASK_USER_PARAMETER_DESCRIPTIONS.multiSelect,
        }),
      ),
    }),
    {
      minItems: 1,
      maxItems: MAX_QUESTIONS,
      description: ASK_USER_PARAMETER_DESCRIPTIONS.questions,
    },
  ),
});

interface AskUserDetails {
  results: QuestionResult[] | null;
  cancelled: boolean;
}

type FormSelection = { results: QuestionResult[] } | null;

const FREE_FORM_LABEL = "Write my own answer…";

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const questions: FormQuestion[] = params.questions.map((q) => ({
        question: q.question,
        header: q.header,
        options: q.options,
        multiSelect: q.multi_select ?? false,
      }));

      const reply = (outcome: AskUserOutcome) => ({
        content: [{ type: "text" as const, text: buildResultMessage(outcome) }],
        details: {
          results: outcome.kind === "answered" ? outcome.results : null,
          cancelled: outcome.kind !== "answered",
        } satisfies AskUserDetails,
      });

      for (const q of questions) {
        if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
          throw new Error(
            `Each question needs ${MIN_OPTIONS}-${MAX_OPTIONS} options ("${q.question.slice(0, 40)}" has ${q.options.length}). Retry with valid counts.`,
          );
        }
      }

      if (ctx.mode !== "tui") return reply({ kind: "no-ui" });
      if (signal?.aborted) return reply({ kind: "cancelled" });

      const selection = await ctx.ui.custom<FormSelection>(
        (tui, theme, _keybindings, done) => {
          const many = questions.length > 1;
          const submitTab = questions.length; // virtual tab index
          const answers: AnswerState[] = emptyAnswers(questions.length);
          const cursors = questions.map(() => 0);
          let tab = 0;
          let submitCursor = 0;
          let inputMode: "options" | "custom" | "note" = "options";
          let notice: string | undefined;
          let cachedLines: string[] | undefined;
          let settled = false;

          const finish = (result: FormSelection) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            done(result);
          };
          const onAbort = () => finish(null);
          signal?.addEventListener("abort", onAbort, { once: true });

          const editorTheme: EditorTheme = {
            borderColor: (s) => theme.fg("accent", s),
            selectList: {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          };
          const editor = new Editor(tui, editorTheme);

          const refresh = () => {
            cachedLines = undefined;
            tui.requestRender();
          };

          /**
           * Options of the current question, plus the free-form entry and —
           * for multi-select, where enter toggles instead of confirming — an
           * explicit Done row (the only way to finish a single-question
           * multi-select form).
           */
          const entries = (): (
            | { label: string; description?: string }
            | { label: string; isFreeForm: true }
            | { label: string; isSubmit: true }
          )[] => [
            ...questions[tab].options,
            { label: FREE_FORM_LABEL, isFreeForm: true as const },
            ...(questions[tab].multiSelect
              ? [{ label: "Done — continue", isSubmit: true as const }]
              : []),
          ];

          const buildResults = (): QuestionResult[] =>
            questions.map((q, i) => ({
              question: q.question,
              answers: answerTexts(q, answers[i]),
              wasCustom: answers[i].custom !== undefined,
              note: answers[i].note,
            }));

          const submit = () => {
            const missing = firstUnanswered(answers);
            if (missing !== undefined) {
              tab = missing;
              notice = "answer the remaining questions first";
              refresh();
              return;
            }
            finish({ results: buildResults() });
          };

          /** After answering question `index`, move on (or finish). */
          const advanceFrom = (index: number) => {
            if (!many) {
              finish({ results: buildResults() });
              return;
            }
            tab = allAnswered(answers) ? submitTab : nextTarget(answers, index);
            refresh();
          };

          const chooseSingle = (optionIndex: number) => {
            answers[tab] = { ...answers[tab], selected: [optionIndex], custom: undefined };
            advanceFrom(tab);
          };

          editor.onSubmit = (value) => {
            const trimmed = value.trim();
            const current = tab;
            if (inputMode === "note") {
              answers[current] = {
                ...answers[current],
                note: trimmed || undefined,
              };
              inputMode = "options";
              editor.setText("");
              // A note on an already-chosen single answer confirms it.
              if (!questions[current].multiSelect && isAnswered(answers[current])) {
                advanceFrom(current);
              } else {
                refresh();
              }
            } else if (trimmed) {
              answers[current] = { selected: [], custom: trimmed, note: answers[current].note };
              inputMode = "options";
              editor.setText("");
              advanceFrom(current);
            } else {
              inputMode = "options";
              editor.setText("");
              refresh();
            }
          };

          const handleOptionAction = (optionIndex: number) => {
            const list = entries();
            const option = list[optionIndex];
            cursors[tab] = optionIndex;
            if ("isFreeForm" in option) {
              inputMode = "custom";
              refresh();
              return;
            }
            if ("isSubmit" in option) {
              if (!isAnswered(answers[tab])) {
                notice = "select at least one option first";
                refresh();
                return;
              }
              notice = undefined;
              advanceFrom(tab);
              return;
            }
            if (questions[tab].multiSelect) {
              answers[tab] = toggleSelection(answers[tab], optionIndex);
              refresh();
            } else {
              chooseSingle(optionIndex);
            }
          };

          const moveTab = (delta: number) => {
            if (!many) return;
            const total = questions.length + 1; // + submit tab
            tab = (tab + delta + total) % total;
            notice = undefined;
            refresh();
          };

          const handleInput = (data: string) => {
            if (inputMode !== "options") {
              if (matchesKey(data, Key.escape)) {
                inputMode = "options";
                editor.setText("");
                refresh();
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }

            if (matchesKey(data, Key.left)) {
              moveTab(-1);
              return;
            }
            if (matchesKey(data, Key.right)) {
              moveTab(1);
              return;
            }
            if (matchesKey(data, Key.escape)) {
              finish(null);
              return;
            }

            // Submit tab: review + submit/cancel.
            if (tab === submitTab) {
              if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
                submitCursor = submitCursor === 0 ? 1 : 0;
                refresh();
                return;
              }
              if (data === "1") {
                submit();
                return;
              }
              if (data === "2") {
                finish(null);
                return;
              }
              if (matchesKey(data, Key.enter)) {
                if (submitCursor === 0) submit();
                else finish(null);
              }
              return;
            }

            const list = entries();
            if (matchesKey(data, Key.up)) {
              cursors[tab] = (cursors[tab] - 1 + list.length) % list.length;
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              cursors[tab] = (cursors[tab] + 1) % list.length;
              refresh();
              return;
            }
            if (matchesKey(data, Key.tab)) {
              const option = list[cursors[tab]];
              if ("isSubmit" in option) return;
              if ("isFreeForm" in option) {
                inputMode = "custom";
              } else {
                inputMode = "note";
                editor.setText(answers[tab].note ?? "");
              }
              refresh();
              return;
            }
            if (data === " " && questions[tab].multiSelect) {
              const option = list[cursors[tab]];
              if (!("isFreeForm" in option) && !("isSubmit" in option)) {
                answers[tab] = toggleSelection(answers[tab], cursors[tab]);
                refresh();
              }
              return;
            }
            if (data.length === 1 && data >= "1" && data <= String(list.length)) {
              handleOptionAction(Number(data) - 1);
              return;
            }
            if (matchesKey(data, Key.enter)) {
              handleOptionAction(cursors[tab]);
            }
          };

          const renderTabBar = (width: number): string => {
            const parts: string[] = [theme.fg("dim", "←")];
            questions.forEach((q, i) => {
              const box = isAnswered(answers[i]) ? "☒" : "☐";
              const label = ` ${box} ${tabLabel(q, i)} `;
              parts.push(
                i === tab
                  ? theme.bg("selectedBg", theme.bold(label))
                  : theme.fg("muted", label),
              );
            });
            const submitLabel = " ✓ Submit ";
            parts.push(
              tab === submitTab
                ? theme.bg("selectedBg", theme.bold(submitLabel))
                : theme.fg("muted", submitLabel),
            );
            parts.push(theme.fg("dim", "→"));
            return truncateToWidth(` ${parts.join(" ")}`, width);
          };

          const render = (width: number): string[] => {
            if (cachedLines) return cachedLines;
            const lines: string[] = [];
            const add = (s: string) => lines.push(truncateToWidth(s, width));

            const title = many ? " Questions " : " Question ";
            add(
              theme.fg(
                "accent",
                `─${title}${"─".repeat(Math.max(0, width - title.length - 1))}`,
              ),
            );
            if (many) {
              add(renderTabBar(width));
              lines.push("");
            }

            if (tab === submitTab) {
              add(` ${theme.fg("text", theme.bold("Review your answers"))}`);
              lines.push("");
              questions.forEach((q, i) => {
                add(` ${theme.fg("muted", "●")} ${theme.fg("text", q.question)}`);
                const texts = answerTexts(q, answers[i]);
                const answerLine = texts.length > 0 ? texts.join(", ") : "(unanswered)";
                add(
                  `   ${theme.fg("success", "→")} ${theme.fg(
                    texts.length > 0 ? "success" : "warning",
                    answerLine,
                  )}${answers[i].note ? theme.fg("muted", ` — ${answers[i].note}`) : ""}`,
                );
              });
              lines.push("");
              add(` ${theme.fg("muted", "Ready to submit your answers?")}`);
              lines.push("");
              const submitRow = (index: number, label: string) => {
                const selected = submitCursor === index;
                const prefix = selected ? theme.fg("accent", " ❯ ") : "   ";
                add(prefix + theme.fg(selected ? "accent" : "text", `${index + 1}. ${label}`));
              };
              submitRow(0, "Submit answers");
              submitRow(1, "Cancel");
            } else {
              const question = questions[tab];
              const answer = answers[tab];
              for (const line of wrapText(question.question, Math.max(10, width - 2))) {
                add(` ${theme.fg("text", theme.bold(line))}`);
              }
              lines.push("");

              const list = entries();
              for (let i = 0; i < list.length; i++) {
                const option = list[i];
                const isFree = "isFreeForm" in option;
                const isSubmit = "isSubmit" in option;
                const highlighted = i === cursors[tab];
                const chosen = answer.custom === undefined && answer.selected.includes(i);
                const prefix = highlighted ? theme.fg("accent", " ❯ ") : "   ";
                if (isSubmit) {
                  const count = answer.selected.length;
                  const label = `✓ ${option.label}${count > 0 ? ` (${count} selected)` : ""}`;
                  add(
                    prefix +
                      theme.fg(highlighted ? "accent" : count > 0 ? "success" : "dim", label),
                  );
                  continue;
                }
                const check = question.multiSelect && !isFree
                  ? `${chosen ? theme.fg("success", "☒") : theme.fg("dim", "☐")} `
                  : "";
                const marker = !question.multiSelect && chosen ? theme.fg("success", "✓ ") : "";
                const label = `${isFree ? "✎" : `${i + 1}.`} ${option.label}`;
                if (highlighted || (isFree && inputMode === "custom")) {
                  add(prefix + check + marker + theme.fg("accent", label));
                } else {
                  add(prefix + check + marker + theme.fg(isFree ? "muted" : "text", label));
                }
                const description =
                  "description" in option ? option.description : undefined;
                if (!isFree && description) {
                  add(`      ${theme.fg("muted", description)}`);
                }
              }
              if (answer.custom !== undefined) {
                lines.push("");
                add(
                  ` ${theme.fg("success", "✓")} ${theme.fg("muted", "(wrote)")} ${theme.fg("accent", answer.custom)}`,
                );
              }

              if (inputMode !== "options") {
                lines.push("");
                add(
                  theme.fg(
                    "muted",
                    inputMode === "note" ? " Note for this answer:" : " Your answer:",
                  ),
                );
                for (const line of editor.render(width - 2)) {
                  add(` ${line}`);
                }
              }
            }

            lines.push("");
            const navHint = many ? " · ←→ questions" : "";
            const hint =
              inputMode === "note"
                ? " Enter save note • Esc back"
                : inputMode === "custom"
                  ? " Enter submit • Esc back"
                  : tab === submitTab
                    ? ` Enter confirm${navHint} • Esc dismiss`
                    : questions[tab]?.multiSelect
                      ? ` space/enter toggle • ✓ Done to continue${navHint} • Tab note • Esc dismiss`
                      : ` ↑↓ or 1-${entries().length} select • Enter confirm${navHint} • Tab note • Esc dismiss`;
            add(theme.fg("dim", notice ? ` ${notice}` : hint));
            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          };

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
            dispose: () => {
              signal?.removeEventListener("abort", onAbort);
            },
          };
        },
      );

      if (selection === null) {
        return reply({ kind: signal?.aborted ? "cancelled" : "dismissed" });
      }
      return reply({ kind: "answered", results: selection.results });
    },

    renderCall(args, theme) {
      const questions = Array.isArray(args.questions) ? args.questions : [];
      let text =
        theme.fg("toolTitle", theme.bold("ask_user ")) +
        theme.fg(
          "muted",
          questions.length === 1
            ? String(questions[0]?.question ?? "")
            : `${questions.length} questions`,
        );
      if (questions.length > 1) {
        for (const [i, q] of questions.entries()) {
          text += `\n${theme.fg("muted", `  ${i + 1}. ${q.question}`)}`;
        }
      } else if (questions[0]?.options) {
        const numbered = questions[0].options.map(
          (o: { label: string }, i: number) => `${i + 1}. ${o.label}`,
        );
        text += `\n${theme.fg("dim", `  ${numbered.join("  ")}`)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.cancelled || !details.results) {
        return new Text(theme.fg("warning", "✗ no answer"), 0, 0);
      }
      const lines = details.results.map((r) => {
        const answer = r.wasCustom
          ? theme.fg("muted", "(wrote) ") + theme.fg("accent", r.answers[0] ?? "")
          : theme.fg("accent", r.answers.join(", "));
        const note = r.note ? theme.fg("muted", ` — ${r.note}`) : "";
        const prefix =
          details.results!.length > 1
            ? theme.fg("muted", `${truncateToWidth(r.question, 40, "…")} `)
            : "";
        return theme.fg("success", "✓ ") + prefix + answer + note;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
