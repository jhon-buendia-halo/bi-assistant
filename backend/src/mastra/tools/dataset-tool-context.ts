/**
 * What every dataset tool shares (agents.md 3.1, 3.15): the request-context
 * key of the session's datasets and the description of a call's rationale.
 * Its own module, so `explore_result` and the other dataset tools read the
 * same values without importing each other.
 */

/** requestContext key carrying the session's dataset names. */
export const DATASETS_CONTEXT_KEY = 'datasets';

/**
 * Every data-gathering call states, in the assistant's own words, why it is
 * being made — so an answer can show the route it took, not just the SQL.
 */
export const RATIONALE_DESCRIPTION = [
  'One or two sentences of plain business English saying what this step',
  "checks and why it moves toward answering the user's question. No SQL",
  'jargon, no restating the statement.',
].join(' ');
