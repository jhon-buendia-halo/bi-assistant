/**
 * Avery's conversation export (agents.md 2.21, 3.18): the gate of her
 * `export_conversation` tool (whether the user's words ask to export the
 * conversation), the tool's input, and the check that every figure she
 * writes for the file is one the conversation's answers already gave.
 * Zod and plain code only, no framework import.
 */
import { z } from 'zod';

/** Avery's tool that exports the conversation. */
export const EXPORT_CONVERSATION_TOOL = 'export_conversation';
/** The skill with the export's format rules (agents.md 7.4). */
export const CONVERSATION_EXPORT_SKILL = 'conversation-export';
/** The most export_conversation calls in one run. */
export const EXPORT_CONVERSATION_MAX_CALLS = 2;
/** Each earlier question in Avery's run facts is cut at this length. */
export const EXPORT_QUESTION_CAP = 140;

/** The text in lower case without accents ("Presentación" → "presentacion"). */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** A file the conversation can be exported to. */
const FORMAT_WORDS =
  /\b(?:pdf|pptx?|power ?point|slides?|slide ?deck|deck|presentations?|diapositivas?|presentacion(?:es)?)\b/;
/** What is exported: the conversation, or the work in it. */
const TARGET_WORDS =
  /\b(?:conversation|chat|report|analysis|conversacion|informe|reporte|analisis)\b/;
/** Asking for the file to leave the app. */
const EXPORT_VERBS =
  /\b(?:export\w*|download\w*|share|sharing|shareable|descarga\w*|compart\w*)\b/;
/** Asking for a file to be made: counts with a format only. */
const MAKE_VERBS =
  /\b(?:make|create|build|generate|turn|prepare|produce|convert|need|want|haz\w*|crea\w*|genera\w*|prepara\w*|convierte\w*|arma\w*|necesito|quiero)\b/;

/**
 * True when the text asks to export, download or share the conversation (or
 * its report or analysis) as a PDF or a PowerPoint (slides, a deck, a
 * presentation), in English or Spanish, ignoring case and accents. A
 * question that merely names a report ("what does the report say") is no
 * export, nor is a download of data ("download the data as CSV").
 */
export function asksForExport(text: string): boolean {
  const words = folded(text ?? '');
  const format = FORMAT_WORDS.test(words);
  if (EXPORT_VERBS.test(words)) return format || TARGET_WORDS.test(words);
  return format && (MAKE_VERBS.test(words) || TARGET_WORDS.test(words));
}

/** A number as written: digits with `.` or `,` between digit groups. */
const NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * The value of a number written with `group` between thousands and
 * `decimal` before the fraction (`1,234.5` or `1.234,5`); undefined when it
 * cannot be read that way (`6,3` has no thousands group of three digits).
 */
function valueAs(
  written: string,
  group: string,
  decimal: string,
): number | undefined {
  const [whole, fraction, ...rest] = written.split(decimal);
  if (rest.length) return undefined;
  const groups = whole.split(group);
  if (groups.length > 1) {
    if (!/^\d{1,3}$/.test(groups[0])) return undefined;
    if (groups.slice(1).some((part) => !/^\d{3}$/.test(part))) return undefined;
  } else if (!/^\d+$/.test(whole)) {
    return undefined;
  }
  if (fraction !== undefined && !/^\d+$/.test(fraction)) return undefined;
  return Number(
    `${groups.join('')}${fraction !== undefined ? `.${fraction}` : ''}`,
  );
}

/** Every value a written number can have, under either grouping. */
function valuesOf(written: string): number[] {
  return [valueAs(written, ',', '.'), valueAs(written, '.', ',')].filter(
    (value): value is number => value !== undefined,
  );
}

/**
 * The figures in `texts` that no answer gives (Avery's export, agents.md
 * 3.18): each number written in them (a token with a digit), distinct, in
 * order of first appearance, unless the same string is a number of the
 * answers' text or its value is one, read as `1,234.5` or as `1.234,5`.
 */
export function figuresNotInAnswers(
  texts: readonly string[],
  answers: readonly string[],
): string[] {
  const written = new Set<string>();
  const values = new Set<number>();
  for (const answer of answers) {
    for (const [number] of (answer ?? '').matchAll(NUMBER)) {
      written.add(number);
      for (const value of valuesOf(number)) values.add(value);
    }
  }
  const missing: string[] = [];
  for (const text of texts) {
    for (const [number] of (text ?? '').matchAll(NUMBER)) {
      if (missing.includes(number) || written.has(number)) continue;
      if (valuesOf(number).some((value) => values.has(value))) continue;
      missing.push(number);
    }
  }
  return missing;
}

/** The input of export_conversation: what Avery writes for the file. */
export const exportContentSchema = z.object({
  formats: z
    .array(z.enum(['pdf', 'pptx']))
    .min(1)
    .default(['pdf', 'pptx'])
    .describe(
      'The files to make: "pdf", "pptx" (PowerPoint), or both. Both when the user names none.',
    ),
  title: z
    .string()
    .min(3)
    .max(90)
    .describe(
      "A business title for the file, in the conversation's language: not the first question.",
    ),
  subtitle: z
    .string()
    .max(160)
    .optional()
    .describe('What the conversation covered, in one line.'),
  summary: z
    .array(z.string().max(240))
    .min(2)
    .max(5)
    .describe(
      'Two to five bullets, the bottom line first: each a finding with its figure copied from the answers.',
    ),
  turns: z
    .array(
      z.object({
        number: z
          .number()
          .int()
          .min(1)
          .describe('The earlier question it is about: 1 for the first.'),
        headline: z
          .string()
          .max(90)
          .describe("The answer's bottom line, in one line."),
        points: z
          .array(z.string().max(200))
          .max(3)
          .describe('Up to three points the answer made.'),
      }),
    )
    .describe(
      'One entry per earlier question of the conversation, in their order.',
    ),
  includeSql: z
    .boolean()
    .default(false)
    .describe(
      "Add each query's SQL to the appendix. Only when the user asks for the SQL.",
    ),
});

/** What Avery writes for the file (the tool's input, parsed). */
export type ExportContent = z.infer<typeof exportContentSchema>;

/** Every text of Avery's content that the figure check reads. */
export function exportContentTexts(content: ExportContent): string[] {
  return [
    content.title,
    ...(content.subtitle ? [content.subtitle] : []),
    ...content.summary,
    ...content.turns.flatMap((turn) => [turn.headline, ...turn.points]),
  ];
}

/** The reply when the figure check fails (agents.md 3.18). */
export function refusedFiguresReply(figures: readonly string[]): string {
  return `These figures are not in the conversation's answers: ${figures.join(', ')}. Use only figures from the answers, then call export_conversation again.`;
}

/** The earlier questions, numbered and cut, as Avery's run facts list them. */
export function exportFact(questions: readonly string[]): string {
  const listed = questions
    .map((question, index) => {
      const text = question.replace(/\s+/g, ' ').trim();
      const cut =
        text.length > EXPORT_QUESTION_CAP
          ? `${text.slice(0, EXPORT_QUESTION_CAP)}…`
          : text;
      return `${index + 1}. "${cut}"`;
    })
    .join(' ');
  return `The user asked to export the conversation: export_conversation is available. Its earlier questions, in order: ${listed || '(none)'}`;
}
