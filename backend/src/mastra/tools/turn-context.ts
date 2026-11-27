/**
 * requestContext keys every turn sets for its tools (agents.md 4.2): plain
 * constants, no framework import.
 */

/** The session or run host the turn runs on; tools scope their reads to it. */
export const SESSION_ID_CONTEXT_KEY = 'session-id';

/**
 * The user's message for this turn. Monitoring reads it when a model input
 * has no user message (session-trajectory.ts).
 */
export const TURN_QUESTION_CONTEXT_KEY = 'turn-question';
