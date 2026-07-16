/**
 * ask_user — the model asks one multiple-choice question in a popup.
 *
 * 2-5 model-provided options plus an always-appended "Write my own answer…"
 * entry that opens an inline editor (Esc returns to the options). Arrow or
 * number keys select, Enter confirms, Esc on the options dismisses — which
 * is reported to the model as a decline, never as an answer.
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
  MIN_OPTIONS,
  type AskUserOutcome,
} from "./prompt.ts";
import { wrapText } from "./src/wrap.ts";

const AskUserParams = Type.Object({
  question: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.question,
  }),
  options: Type.Array(
    Type.Object({
      label: Type.String({
        description: ASK_USER_PARAMETER_DESCRIPTIONS.optionLabel,
      }),
      description: Type.Optional(
        Type.String({
          description: ASK_USER_PARAMETER_DESCRIPTIONS.optionDescription,
        }),
      ),
    }),
    {
      minItems: MIN_OPTIONS,
      maxItems: MAX_OPTIONS,
      description: ASK_USER_PARAMETER_DESCRIPTIONS.options,
    },
  ),
});

interface AskUserDetails {
  question: string;
  options: string[];
  answer: string | null;
  note: string | null;
  wasCustom: boolean;
  cancelled: boolean;
}

interface DisplayOption {
  label: string;
  description?: string;
  isFreeForm?: boolean;
}

type Selection = {
  answer: string;
  wasCustom: boolean;
  index?: number;
  note?: string;
} | null;

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const reply = (outcome: AskUserOutcome) => ({
        content: [{ type: "text" as const, text: buildResultMessage(outcome) }],
        details: {
          question: params.question,
          options: params.options.map((option) => option.label),
          answer:
            outcome.kind === "custom" || outcome.kind === "selected"
              ? outcome.answer
              : null,
          note: outcome.kind === "selected" ? (outcome.note ?? null) : null,
          wasCustom: outcome.kind === "custom",
          cancelled: outcome.kind !== "custom" && outcome.kind !== "selected",
        } satisfies AskUserDetails,
      });

      if (
        params.options.length < MIN_OPTIONS ||
        params.options.length > MAX_OPTIONS
      ) {
        throw new Error(
          `ask_user requires ${MIN_OPTIONS}-${MAX_OPTIONS} options (got ${params.options.length}). Retry with a valid count.`,
        );
      }

      if (ctx.mode !== "tui") return reply({ kind: "no-ui" });
      if (signal?.aborted) return reply({ kind: "cancelled" });

      const allOptions: DisplayOption[] = [
        ...params.options,
        { label: "Write my own answer…", isFreeForm: true },
      ];

      const selection = await ctx.ui.custom<Selection>(
        (tui, theme, _keybindings, done) => {
          let optionIndex = 0;
          let inputMode: "options" | "custom" | "note" = "options";
          let cachedLines: string[] | undefined;
          let settled = false;

          const finish = (result: Selection) => {
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
          editor.onSubmit = (value) => {
            const trimmed = value.trim();
            if (inputMode === "note") {
              // Empty note degrades to a plain selection.
              finish({
                answer: allOptions[optionIndex].label,
                wasCustom: false,
                index: optionIndex + 1,
                note: trimmed || undefined,
              });
            } else if (trimmed) {
              finish({ answer: trimmed, wasCustom: true });
            } else {
              inputMode = "options";
              editor.setText("");
              refresh();
            }
          };

          const refresh = () => {
            cachedLines = undefined;
            tui.requestRender();
          };

          const selectOption = (index: number) => {
            const option = allOptions[index];
            if (option.isFreeForm) {
              optionIndex = index;
              inputMode = "custom";
              refresh();
            } else {
              finish({
                answer: option.label,
                wasCustom: false,
                index: index + 1,
              });
            }
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
            if (matchesKey(data, Key.tab)) {
              const option = allOptions[optionIndex];
              inputMode = option.isFreeForm ? "custom" : "note";
              refresh();
              return;
            }
            if (matchesKey(data, Key.up)) {
              optionIndex =
                (optionIndex - 1 + allOptions.length) % allOptions.length;
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              optionIndex = (optionIndex + 1) % allOptions.length;
              refresh();
              return;
            }
            if (
              data.length === 1 &&
              data >= "1" &&
              data <= String(allOptions.length)
            ) {
              selectOption(Number(data) - 1);
              return;
            }
            if (matchesKey(data, Key.enter)) {
              selectOption(optionIndex);
              return;
            }
            if (matchesKey(data, Key.escape)) {
              finish(null);
            }
          };

          const render = (width: number): string[] => {
            if (cachedLines) return cachedLines;
            const lines: string[] = [];
            const add = (s: string) => lines.push(truncateToWidth(s, width));

            const title = " Question ";
            add(
              theme.fg(
                "accent",
                `─${title}${"─".repeat(Math.max(0, width - title.length - 1))}`,
              ),
            );
            for (const line of wrapText(
              params.question,
              Math.max(10, width - 2),
            )) {
              add(` ${theme.fg("text", theme.bold(line))}`);
            }
            lines.push("");

            for (let i = 0; i < allOptions.length; i++) {
              const option = allOptions[i];
              const selected = i === optionIndex;
              const prefix = selected ? theme.fg("accent", " ❯ ") : "   ";
              const label = `${option.isFreeForm ? "✎" : `${i + 1}.`} ${option.label}`;
              if (selected || (option.isFreeForm && inputMode === "custom")) {
                add(prefix + theme.fg("accent", label));
              } else {
                add(
                  prefix + theme.fg(option.isFreeForm ? "muted" : "text", label),
                );
              }
              if (option.description) {
                add(`      ${theme.fg("muted", option.description)}`);
              }
            }

            if (inputMode !== "options") {
              lines.push("");
              add(
                theme.fg(
                  "muted",
                  inputMode === "note"
                    ? ` Note for "${allOptions[optionIndex].label}":`
                    : " Your answer:",
                ),
              );
              for (const line of editor.render(width - 2)) {
                add(` ${line}`);
              }
            }

            lines.push("");
            add(
              theme.fg(
                "dim",
                inputMode === "note"
                  ? " Enter submit (empty note = plain selection) • Esc back to options"
                  : inputMode === "custom"
                    ? " Enter submit • Esc back to options"
                    : ` ↑↓ or 1-${allOptions.length} select • Enter confirm • Tab note • Esc dismiss`,
              ),
            );
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
      if (selection.wasCustom) {
        return reply({ kind: "custom", answer: selection.answer });
      }
      return reply({
        kind: "selected",
        answer: selection.answer,
        index: selection.index ?? 0,
        note: selection.note,
      });
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("ask_user "));
      text += theme.fg(
        "muted",
        typeof args.question === "string" ? args.question : "",
      );
      const options = Array.isArray(args.options)
        ? (args.options as DisplayOption[])
        : [];
      if (options.length > 0) {
        const numbered = options.map((o, i) => `${i + 1}. ${o.label}`);
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
      if (details.cancelled || details.answer === null) {
        return new Text(theme.fg("warning", "✗ no answer"), 0, 0);
      }
      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("muted", "(wrote) ") +
            theme.fg("accent", details.answer),
          0,
          0,
        );
      }
      const index = details.options.indexOf(details.answer) + 1;
      const display =
        index > 0 ? `${index}. ${details.answer}` : details.answer;
      let text = theme.fg("success", "✓ ") + theme.fg("accent", display);
      if (details.note) {
        text += theme.fg("muted", ` — ${details.note}`);
      }
      return new Text(text, 0, 0);
    },
  });
}
