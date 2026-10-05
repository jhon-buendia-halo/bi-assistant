/**
 * Business expert mode — frontend mirror of
 * `backend/src/modules/expert-mode/entities/reasoning-trace.entity.ts`.
 * Change both together.
 */

export type EvidenceBasis =
  | 'knowledge'
  | 'metric'
  | 'verified_query'
  | 'schema'
  | 'data_sample'
  | 'convention'
  | 'assumption';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export type ConfidenceSignalId =
  | 'schema_grounding'
  | 'join_grounding'
  | 'knowledge_coverage'
  | 'execution'
  | 'cross_check'
  | 'verified_match'
  | 'assumption_load'
  | 'self_report';

export interface ConfidenceSignal {
  id: ConfidenceSignalId;
  label: string;
  /** 0..1 */
  value: number;
  /** 0..1 */
  weight: number;
  note: string;
}

export interface Confidence {
  /** 0..1 */
  score: number;
  band: ConfidenceBand;
  signals: ConfidenceSignal[];
}

/** Band thresholds, mirrored from the backend contract. */
export const CONFIDENCE_BANDS = {
  /** `score >= high` → 'high' */
  high: 0.8,
  /** `score >= medium` → 'medium', otherwise 'low' */
  medium: 0.55,
} as const;

export type ReasoningBlockKind =
  | 'interpretation'
  | 'data-selection'
  | 'assumptions'
  | 'metric'
  | 'sql';

export const REASONING_BLOCK_KINDS: ReasoningBlockKind[] = [
  'interpretation',
  'data-selection',
  'assumptions',
  'metric',
  'sql',
];

export interface TermMapping {
  term: string;
  mappedTo: string;
  basis: EvidenceBasis;
  sourceRef?: string;
}

export interface InterpretationBlock {
  kind: 'interpretation';
  restatement: string;
  terms: TermMapping[];
  ambiguities: string[];
  confidence: Confidence;
}

export type TableRole = 'fact' | 'dimension' | 'bridge' | 'lookup' | 'view';

export interface TableChoice {
  entity: string;
  role: TableRole;
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

export interface DataSelectionBlock {
  kind: 'data-selection';
  tables: TableChoice[];
  joins: JoinEdge[];
  rejected: RejectedEntity[];
  confidence: Confidence;
}

export interface Assumption {
  id: string;
  statement: string;
  sqlFragment?: string;
  basis: EvidenceBasis;
  sourceRef?: string;
  alternative?: string;
}

export interface AssumptionsBlock {
  kind: 'assumptions';
  items: Assumption[];
  confidence: Confidence;
}

export interface MetricBlock {
  kind: 'metric';
  name: string;
  formula: string;
  grain: string;
  basis: EvidenceBasis;
  sourceRef?: string;
  confidence: Confidence;
}

export interface SqlAnnotation {
  clause: string;
  explanation: string;
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

export interface BlockFeedback {
  vote?: BlockVote;
  comment?: string;
  at: string;
}

export interface ReasoningTrace {
  id: string;
  version: 1;
  blocks: ReasoningBlock[];
  overall: Confidence;
  generatedAt: string;
  model?: string;
  feedback?: Partial<Record<ReasoningBlockKind, BlockFeedback>>;
}

/**
 * Body of `POST /sessions/:id/expert/feedback`. PATCH semantics: only the
 * fields present are changed; `vote: null` clears a vote.
 */
export interface BlockFeedbackInput {
  messageAt: string;
  block: ReasoningBlockKind;
  vote?: BlockVote | null;
  comment?: string;
}

/**
 * Progress notice streamed while the expert pass runs (SSE type
 * `expert-status`). `failed` means the answer is saved without a trace.
 */
export type ExpertStatus = 'cross-check' | 'explaining' | 'failed';

export const EXPERT_STATUSES: readonly ExpertStatus[] = [
  'cross-check',
  'explaining',
  'failed',
];
