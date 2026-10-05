import type { ChatMessage } from '../../sessions/entities/session.entity';

/**
 * Answer pinning — one saved answer per "lineage" (question + datasets +
 * prior-turn chain + mode), replayed verbatim while the knowledge/metrics/
 * schema/model it was derived under has not moved and its SQL still returns
 * the same rows. See CLAUDE.md's "Learning from feedback + answer pinning"
 * section and `docs/plans/learn-from-feedback-engineering.md` for the full
 * design; `pin-key.ts` builds the two hashes below, `eligibility.ts` decides
 * whether a turn may be pinned at all.
 */
export type PinMode = 'plain' | 'careful' | 'expert';

/**
 * The hashed inputs behind `fingerprint`, kept alongside it (not just the
 * final hash) so a stored pin is debuggable — which part moved is visible
 * without recomputing every hash from scratch.
 */
export interface FingerprintParts {
  v: 1;
  knowledge: string;
  metrics: string;
  verified: string;
  schema: string;
  model: string;
}

export interface AnswerPinDoc {
  id: string;
  /** Identity of the lineage — see `pin-key.ts#lineageKeyFor`. Unique per doc. */
  lineageKey: string;
  /** Hash of everything that legitimately changes the answer — see `pin-key.ts#fingerprintFor`. */
  fingerprint: string;
  fingerprintParts: FingerprintParts;
  question: string;
  normalizedQuestion: string;
  /** Dataset names the lineage was answered over (order-independent). */
  datasets: string[];
  /** Normalized prior user messages in this thread, oldest first. */
  chain: string[];
  mode: PinMode;
  datasourceId: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  rowLimit: number;
  /** The persisted assistant message minus at/feedback/usage/consistency; expertTrace.feedback stripped too. */
  message: Omit<ChatMessage, 'at' | 'feedback' | 'usage' | 'consistency'>;
  /** Ids of the `KnowledgeUse` entries the answer was derived with. */
  knowledgeIds: string[];
  sourceSessionId: string;
  sourceMessageAt: string;
  replays: number;
  lastReplayedAt?: string;
  /**
   * Set by a 👎 on the pinned answer (whole answer or one reasoning block). A
   * rejected pin is kept — so the next fresh derivation can still report what
   * changed since (`consistency.kind: 'updated'` + the lessons learned) — but
   * it is never replayed and its wording is never kept. A fresh derivation
   * replaces it with an un-rejected pin; a 👍 (`approve`) clears it.
   */
  rejectedAt?: string;
  /** Which reasoning block the 👎 was on; absent for a whole-answer 👎. */
  rejectedBy?: { block?: string };
  createdAt?: string;
  updatedAt?: string;
}

/** Shape returned by `GET /answer-pins` — no rows, no message body. */
export interface AnswerPinSummary {
  lineageKey: string;
  question: string;
  datasets: string[];
  mode: PinMode;
  fingerprint: string;
  sourceSessionId: string;
  sourceMessageAt: string;
  replays: number;
  rejectedAt?: string;
  updatedAt?: string;
}

export function toPinSummary(doc: AnswerPinDoc): AnswerPinSummary {
  return {
    lineageKey: doc.lineageKey,
    question: doc.question,
    datasets: doc.datasets,
    mode: doc.mode,
    fingerprint: doc.fingerprint,
    sourceSessionId: doc.sourceSessionId,
    sourceMessageAt: doc.sourceMessageAt,
    replays: doc.replays,
    ...(doc.rejectedAt ? { rejectedAt: doc.rejectedAt } : {}),
    updatedAt: doc.updatedAt,
  };
}
