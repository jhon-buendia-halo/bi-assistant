/**
 * The summary step of a learning memory (agents.md 2.1, knowledge R42): one
 * call of the configured model rewrites the scope's summary from its stored
 * signals and nothing else. Pure module.
 */

/** Longest summary kept (knowledge R42). */
export const SUMMARY_CHARS = 2_000;

export const SUMMARY_INSTRUCTIONS = [
  'You keep the summary of what rated answers in past sessions taught about one datasource.',
  'You are given the stored signals, oldest first. Each is an approval (`verified_query`: its SQL was right), a `rejection` (its SQL was wrong) or a `correction` (its SQL was wrong; the note says what is right).',
  'Write the summary in three parts, each headed on a line of its own: `Known pitfalls`, `Table guide` and `Learned glossary`. Use short bullet lines. At most 2,000 characters in all.',
  'Rules:',
  '- Write only what the signals say. Never add what no signal says.',
  '- Never quote a row value or anything about a person: no names, emails, identifiers or literal values from the data. Table and column names and category codes are fine.',
  '- When two signals disagree, follow the later one.',
  '- The SQL of a correction or a rejection is what not to do: never present it as a query to reuse.',
  'Reply with the summary only.',
].join('\n');

/** The summary call's message: the signals as stored, oldest first. */
export function summaryPrompt(signals: string[]): string {
  return [
    `Stored signals (${signals.length}), oldest first:`,
    '',
    signals.join('\n\n'),
  ].join('\n');
}
