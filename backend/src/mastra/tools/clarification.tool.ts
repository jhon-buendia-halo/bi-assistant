import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tool-call text Claude models sometimes leak around an argument:
 * `<parameter name="options">…</parameter>`.
 */
const LEAKED_PARAMETER =
  /^\s*<parameter name="[^"]*">\s*|\s*<\/parameter>\s*$/g;

/**
 * The options as one string, one option per line. A list (or a JSON-encoded
 * list) is joined into lines, and a leaked parameter wrapper is dropped.
 */
export function optionLines(value: unknown): unknown {
  const join = (items: unknown[]) =>
    items.every((item) => typeof item === 'string') ? items.join('\n') : items;
  if (Array.isArray(value)) return join(value);
  if (typeof value !== 'string') return value;
  const text = value.replace(LEAKED_PARAMETER, '').trim();
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return join(parsed);
    } catch {
      // Not JSON: read it as lines.
    }
  }
  return text;
}

/** Non-empty lines, each without a leading list marker (`-`, `*`, `1.`). */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

/** The tool's input, shared with the orchestrator's check. */
const clarificationInput = z.object({
  question: z.string().describe('The clarifying question, short and direct'),
  // One string, one option per line: models serialize an array parameter
  // wrongly now and then, a string reliably (agents.md 3.5, BA-210).
  options: z
    .preprocess(
      optionLines,
      z.string().refine(
        (text) => {
          const count = splitLines(text).length;
          return count >= 2 && count <= 4;
        },
        { message: 'Give 2-4 options, one per line' },
      ),
    )
    .describe(
      '2-4 answer options, one per line. Each is a short title, optionally followed by " — " and one line explaining it',
    ),
});

/** One option as stored and shown (data-model `ClarificationOption`). */
export interface ClarificationOption {
  label: string;
  description?: string;
}

/** A dash with a space on each side (`Title — explanation`), or ending the text. */
const OPTION_SEPARATOR = /\s+[—–](?:\s+|$)/;

/** Split each option string into its label and optional description. */
export function clarificationOptions(
  options: string | string[],
): ClarificationOption[] {
  const lines = Array.isArray(options) ? options : splitLines(options);
  return lines.map((option) => {
    const text = option.trim();
    const match = OPTION_SEPARATOR.exec(text);
    if (!match) return { label: text };
    const label = text.slice(0, match.index).trim();
    const description = text.slice(match.index + match[0].length).trim();
    return description ? { label, description } : { label };
  });
}

/**
 * The question and options of an `ask_clarification` call, or undefined when
 * its input fails the tool's schema: such a call is left to fail like any
 * tool, so the model retries instead of the user seeing an empty card.
 */
export function parseClarification(
  args: unknown,
): { question: string; options: ClarificationOption[] } | undefined {
  const parsed = clarificationInput.safeParse(args);
  if (!parsed.success) return undefined;
  return {
    question: parsed.data.question,
    options: clarificationOptions(parsed.data.options),
  };
}

/**
 * UI-facing tool: asking it ends the turn — the harness intercepts the call,
 * renders a clarification card to the user, and the user's pick arrives as
 * the next user message. The execute body is a no-op placeholder.
 */
export const askClarificationTool = createTool({
  id: 'ask_clarification',
  description: [
    'Ask the user ONE clarifying question with 2-4 concrete answer options,',
    'either before starting an analysis when their question is ambiguous',
    '(unclear scope, metric, timeframe, or entity), or mid-analysis when the',
    'data itself is ambiguous — a filter value, member/entity name or',
    'timeframe with several plausible matches. When the ambiguity is about',
    'values, quote the actual values found in the data as the options. The',
    'user picks an option or types their own answer, which arrives as the',
    'next message; continue the analysis from there. At most one call per',
    'user question — do not call this when the intent is already clear or the',
    'user just answered a clarification.',
  ].join(' '),
  inputSchema: clarificationInput,
  execute: () => Promise.resolve({ delivered: true }),
});
