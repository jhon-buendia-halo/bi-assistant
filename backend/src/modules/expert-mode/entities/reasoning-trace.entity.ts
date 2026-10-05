/**
 * Business expert mode — the reasoning trace contract.
 *
 * In business expert mode an answer is not delivered as prose alone: the turn
 * also produces a `ReasoningTrace`, a fixed sequence of blocks that shows how
 * the question was read, which tables were chosen (and why), which
 * assumptions were made, how the metric is defined and how the final SQL maps
 * back to those decisions. Every block carries a `Confidence` built from
 * named signals so the reader can see *why* a block is high or low, and every
 * block can be rated (thumbs up / down + comment) independently.
 *
 * Two sources feed a trace and the boundary between them is deliberate:
 *
 * - The model (the `business-expert` agent) authors the prose and the
 *   structure: the restatement, the term mappings, the table roles, the
 *   assumptions, the SQL annotations, plus one verbalized `selfConfidence`
 *   per block (0..1). It never writes a `Confidence`.
 * - The service computes every `Confidence` deterministically from measured
 *   signals (schema grounding, join grounding, knowledge coverage, execution
 *   outcome, the independent cross-check, verified-query match). The model's
 *   own estimate enters as the `self_report` signal with a small weight,
 *   because verbalized confidence is known to cluster at 80-100% regardless of
 *   difficulty (arXiv 2604.01457).
 *
 * The frontend mirrors these types in
 * `frontend/src/app/features/sessions/models/expert-trace.model.ts`.
 * Change both together.
 */

/** Where a claim in the trace comes from — what the reader can check. */
export type EvidenceBasis =
  /** A curated knowledge snippet (term / instruction / default filter). */
  | 'knowledge'
  /** A governed metric definition. */
  | 'metric'
  /** A user-approved verified query. */
  | 'verified_query'
  /** The dataset schema itself: a column name, type, declared or inferred join. */
  | 'schema'
  /** Values seen in `sample_rows` / query results. */
  | 'data_sample'
  /** A common business convention with no dataset-specific backing. */
  | 'convention'
  /** The model's own guess — nothing in the context backs it. */
  | 'assumption';

export const EVIDENCE_BASES: EvidenceBasis[] = [
  'knowledge',
  'metric',
  'verified_query',
  'schema',
  'data_sample',
  'convention',
  'assumption',
];

/** Bases that count as *grounded* for the knowledge-coverage signal. */
export const GROUNDED_BASES: ReadonlySet<EvidenceBasis> = new Set([
  'knowledge',
  'metric',
  'verified_query',
  'schema',
  'data_sample',
]);

export type ConfidenceBand = 'high' | 'medium' | 'low';

/**
 * One measured contributor to a block's confidence. `value` and `weight` are
 * both 0..1; a signal that could not be measured is omitted rather than
 * reported as 0 (missing evidence is not negative evidence).
 */
export interface ConfidenceSignal {
  id: ConfidenceSignalId;
  label: string;
  value: number;
  weight: number;
  /** One line: what was measured and what it found, e.g. "4/4 tables exist". */
  note: string;
}

export type ConfidenceSignalId =
  /** Fraction of tables / columns referenced by the SQL that exist in the bound datasets. */
  | 'schema_grounding'
  /** Fraction of joins in the SQL whose ON columns match a declared or inferred relationship. */
  | 'join_grounding'
  /** Fraction of term mappings / assumptions backed by a grounded basis (not convention/assumption). */
  | 'knowledge_coverage'
  /** The final SQL ran cleanly: no error, no repair, rows returned, no result-guard warning. */
  | 'execution'
  /** Independent re-derivation (careful-mode cross-check) agreed with the answer's result set. */
  | 'cross_check'
  /** The final SQL matches a user-approved verified query. */
  | 'verified_match'
  /** How many pure assumptions the block leans on (1 = none, 0 = three or more). */
  | 'assumption_load'
  /** The model's own verbalized confidence for the block. */
  | 'self_report';

export interface Confidence {
  /** Weighted mean of `signals` (0..1), rounded to 2 decimals. */
  score: number;
  band: ConfidenceBand;
  signals: ConfidenceSignal[];
}

/** Band thresholds — the "almost sure" line lives here and nowhere else. */
export const CONFIDENCE_BANDS = {
  /** `score >= high` → 'high' */
  high: 0.8,
  /** `score >= medium` → 'medium', otherwise 'low' */
  medium: 0.55,
} as const;

export type ReasoningBlockKind =
  'interpretation' | 'data-selection' | 'assumptions' | 'metric' | 'sql';

export const REASONING_BLOCK_KINDS: ReasoningBlockKind[] = [
  'interpretation',
  'data-selection',
  'assumptions',
  'metric',
  'sql',
];

/** A phrase in the question and what the SQL actually treats it as. */
export interface TermMapping {
  /** The user's words, e.g. "tech employees". */
  term: string;
  /** What it became, e.g. "departments in the Technology division". */
  mappedTo: string;
  basis: EvidenceBasis;
  /** Title of the knowledge snippet / metric / verified query that backs it. */
  sourceRef?: string;
}

export interface InterpretationBlock {
  kind: 'interpretation';
  /** The question restated the way the SQL answers it — one sentence. */
  restatement: string;
  terms: TermMapping[];
  /** Readings the assistant considered and did not take. */
  ambiguities: string[];
  confidence: Confidence;
}

export type TableRole = 'fact' | 'dimension' | 'bridge' | 'lookup' | 'view';

export interface TableChoice {
  /** Fully-qualified `catalog.schema.table` as it appears in the SQL. */
  entity: string;
  role: TableRole;
  /** Why this table and not another — one sentence. */
  reason: string;
  columnsUsed: string[];
}

export interface JoinEdge {
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  basis: EvidenceBasis;
}

export interface RejectedEntity {
  entity: string;
  reason: string;
}

/** Rendered as a diagram: chosen tables as nodes, joins as edges, rejected tables greyed out. */
export interface DataSelectionBlock {
  kind: 'data-selection';
  tables: TableChoice[];
  joins: JoinEdge[];
  rejected: RejectedEntity[];
  confidence: Confidence;
}

export interface Assumption {
  /** Stable within the trace, e.g. "a1"; SQL annotations reference it. */
  id: string;
  /** The assumption in business language. */
  statement: string;
  /** The SQL fragment that implements it, verbatim from the final SQL when possible. */
  sqlFragment?: string;
  basis: EvidenceBasis;
  sourceRef?: string;
  /** What would change if the assumption is wrong. */
  alternative?: string;
}

export interface AssumptionsBlock {
  kind: 'assumptions';
  items: Assumption[];
  confidence: Confidence;
}

export interface MetricBlock {
  kind: 'metric';
  /** Business name, e.g. "Average base salary (USD)". */
  name: string;
  /** The aggregation in SQL terms, e.g. "AVG(annual_base_amount * rate_to_usd)". */
  formula: string;
  /** What one row of the aggregate means, e.g. "per employee active on 2025-12-31". */
  grain: string;
  basis: EvidenceBasis;
  sourceRef?: string;
  confidence: Confidence;
}

export interface SqlAnnotation {
  /** A substring of `sql` (a clause or fragment) the note is about. */
  clause: string;
  explanation: string;
  /** Ids of the assumptions this clause implements. */
  assumptionIds: string[];
}

export interface SqlBlock {
  kind: 'sql';
  sql: string;
  annotations: SqlAnnotation[];
  rowCount?: number;
  confidence: Confidence;
}

export type ReasoningBlock =
  | InterpretationBlock
  | DataSelectionBlock
  | AssumptionsBlock
  | MetricBlock
  | SqlBlock;

export type BlockVote = 'up' | 'down';

/** The latest rating of one block, mirrored onto the message for rendering. */
export interface BlockFeedback {
  vote?: BlockVote;
  comment?: string;
  at: string;
}

export interface ReasoningTrace {
  /** Trace id (uuid) — the feedback collection keys on it together with the block kind. */
  id: string;
  version: 1;
  blocks: ReasoningBlock[];
  /** Whole-answer confidence, derived from the block confidences (see `confidence.ts`). */
  overall: Confidence;
  generatedAt: string;
  /** Model id that authored the blocks, e.g. `openai/gpt-5`. */
  model?: string;
  /** Latest feedback per block kind, mirrored from the `reasoning_feedback` collection. */
  feedback?: Partial<Record<ReasoningBlockKind, BlockFeedback>>;
}

/** One document in the `reasoning_feedback` collection. Upserted by (sessionId, messageAt, block). */
export interface ReasoningFeedbackDoc {
  id: string;
  sessionId: string;
  messageAt: string;
  traceId: string;
  block: ReasoningBlockKind;
  vote?: BlockVote;
  comment?: string;
  /** Copied at write time so the feedback stays readable when the session is deleted. */
  question: string;
  /** Snapshot of the rated block, for the improvement loop. */
  blockSnapshot: ReasoningBlock;
  createdAt: string;
  updatedAt: string;
}
