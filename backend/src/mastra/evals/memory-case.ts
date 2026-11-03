/**
 * The shapes of the memory eval (agents-evals R231 to R246, BA-190): the
 * memory arm a run measures, the teach signals of a memory case, its memory
 * checks, and what an attempt records about its memory.
 *
 * Pure module: no Nest, no Mastra, no model.
 */
import type {
  LearningSignalKind,
  LearningStoreItem,
} from '../../modules/memory/learning-store.port';

/** The memory arms, in the order messages list them (R231). */
export const MEMORY_ARMS = ['none', 'mastra', 'hindsight-mastra'] as const;
export type MemoryArm = (typeof MEMORY_ARMS)[number];

/** A run's arm (R231); `{ memory: 'none' }` on a run saved before it. */
export interface EvalArm {
  memory: MemoryArm;
}

/** One signal a memory case teaches before its probe (R234). */
export interface TeachSignal {
  kind: LearningSignalKind;
  /** ISO 8601 UTC, later than the signal before it. */
  at: string;
  question: string;
  /** PostgreSQL, schema-qualified, literals not yet redacted. */
  sql: string;
  /** A correction's note (required), or a rejection's (optional). */
  note?: string;
}

/** The checks that read an attempt's memory record (R241 to R243). */
export const MEMORY_CHECK_TYPES = [
  'noRowValuesRetained',
  'notRejectedSql',
  'teachNotRecalled',
] as const;
export type MemoryCheckType = (typeof MEMORY_CHECK_TYPES)[number];

/** A memory check as a case declares it, with the criterion it measures. */
export interface MemoryCheckSpec {
  type: MemoryCheckType;
  /** The check's criterion: its type's default (M1 to M3) unless named. */
  criterion?: string;
}

/** A signal the probe's recall returned (R240). */
export interface EvalRecalledSignal {
  documentId: string;
  kind: LearningSignalKind;
  content: string;
}

/** What an attempt under a memory arm records about its memory (R240). */
export interface EvalMemoryRecord {
  /** `eval-<run id>-<case id>-<attempt>` (R238). */
  scope: string;
  /** Every item the scope held after the teach step, as the port lists it. */
  held: LearningStoreItem[];
  /** The signals the probe recalled, oldest first. */
  recalled: EvalRecalledSignal[];
  /** The summary sent in the learned block, when one was. */
  summary?: string;
  /** From the start of the recall to its result or its cut-off. */
  recallMs?: number;
}
