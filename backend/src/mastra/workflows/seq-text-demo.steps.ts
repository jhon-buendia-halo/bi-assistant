/**
 * The sequential test workflow (agents.md 5.13; plan 9.2): a run workflow of
 * three code steps and no LLM. Its step catalogue and the pure code of its
 * steps, with no framework import, so the catalogue and Jest can read it
 * without loading Mastra; the workflow itself is built in
 * ./seq-text-demo.workflow.ts.
 */
import type { WorkflowStepEntry } from './qti-v2-turn.steps';

/** The workflow's registry key and id. */
export const SEQ_TEXT_DEMO_WORKFLOW_ID = 'seq-text-demo';

/** The steps, in the order they run: the workflow page draws them. */
export const SEQ_TEXT_DEMO_STEPS = [
  {
    id: 'clean-text',
    title: 'Clean text',
    kind: 'code',
    summary:
      'Trims the text and collapses repeated spaces. An empty text fails the step.',
    input: ['text'],
    output: ['text'],
    exits: [{ label: 'Empty text', outcome: 'fails' }],
  },
  {
    id: 'count-words',
    title: 'Count words',
    kind: 'code',
    summary: 'Counts the words and characters of the cleaned text.',
    input: ['text'],
    output: ['text', 'words', 'characters'],
    exits: [],
  },
  {
    id: 'format-result',
    title: 'Format result',
    kind: 'code',
    summary:
      'Writes a one-line summary of the counts and the start of the text.',
    input: ['text', 'words', 'characters'],
    output: ['summary'],
    exits: [],
  },
] as const satisfies readonly WorkflowStepEntry[];

/** How much of the text the summary quotes before cutting it with `…`. */
export const SUMMARY_TEXT_LIMIT = 60;

/** What Count words returns besides the text. */
export interface WordCount {
  words: number;
  characters: number;
}

/**
 * Step 1: the text trimmed, every run of whitespace collapsed to one space;
 * an empty text fails the step.
 */
export function cleanText(text: string): string {
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('The text is empty');
  return cleaned;
}

/** Step 2: the whitespace-separated words and the characters of the text. */
export function countWords(text: string): WordCount {
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    characters: text.length,
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Step 3: `<n> word(s), <n> character(s): "<the text>"`, the text cut to its
 * first 60 characters with `…` appended when it is longer.
 */
export function formatResult(input: { text: string } & WordCount): string {
  const quoted =
    input.text.length > SUMMARY_TEXT_LIMIT
      ? `${input.text.slice(0, SUMMARY_TEXT_LIMIT)}…`
      : input.text;
  return `${plural(input.words, 'word')}, ${plural(input.characters, 'character')}: "${quoted}"`;
}
