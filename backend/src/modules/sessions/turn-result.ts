import type {
  ChatMessage,
  CrossCheck,
  ToolDataRecord,
} from './entities/session.entity';
import type { TokenUsage } from '../agents/eval-telemetry';
import type { EngineOptions } from '../engine/engine-options';
import type { StreamEvent } from './sessions.service';

/**
 * What one production turn returns — the single shape shared by chat
 * (`SessionsService.streamMessage`), the CLI golden-set harness and the
 * in-app eval runner.
 *
 * Before this existed the eval tab ran the bare agent and the CLI re-read the
 * persisted session, so the two graded harnesses measured two different
 * systems (engineering plan §2.1). `SessionsService.runTurn` is now the one
 * place a turn happens; every harness reads this object instead of
 * reconstructing the turn from its side effects.
 *
 * Pure types: `import type` only, so importing this file costs nothing at
 * runtime and cannot pull the Nest graph into a script or a spec.
 */

/** How an auto-repaired statement differs from the one the assistant wrote. */
export type SqlRepairKind = 'identifier' | 'syntax' | 'semantic' | 'unknown';

/** One `sql-fixer` repair, kept so a report can show what changed and why. */
export interface SqlRepairRecord {
  original: string;
  repaired: string;
  /** The engine error that triggered the repair. */
  error: string;
  kind: SqlRepairKind;
  /** Set when the repair changed filters, aggregates, joins or literals. */
  warning?: string;
  /** What the fixer call cost, when the provider reported it (a side pass of the turn). */
  usage?: TokenUsage;
}

/** The eight error classes the answer review checks (Omni's list, §9.7). */
export type AnswerReviewCode =
  | 'unsupported-claim'
  | 'date-filter'
  | 'truncated-as-complete'
  | 'prose-arithmetic'
  | 'comparison-window'
  | 'ignored-breakdown'
  | 'degenerate-query'
  | 'metric-or-filter-mismatch';

export interface AnswerReviewFinding {
  code: AnswerReviewCode;
  detail: string;
}

/**
 * The answer review's verdict, persisted on the message like `crossCheck`:
 * `ok` — nothing found; `revised` — findings, and the corrective pass
 * rewrote the answer; `flagged` — findings the corrective pass could not
 * address; `error` — the review could not complete (never loses the answer).
 */
export interface AnswerReview {
  status: 'ok' | 'revised' | 'flagged' | 'error';
  findings: AnswerReviewFinding[];
  /** Short line for the chip's tooltip. */
  note?: string;
}

/**
 * What kind of provider failure ended a turn — the part of it a user can act
 * on: `quota` (no credits left — billing), `rate-limit` (too many requests —
 * wait), `auth` (key rejected — Settings → LLM), `network` (provider
 * unreachable), `timeout` (no reply in time), `unknown` (anything else).
 */
export type ProviderErrorKind =
  'quota' | 'rate-limit' | 'auth' | 'network' | 'timeout' | 'unknown';

/**
 * The first error the model provider (or the stream to it) raised during the
 * turn's main run, classified by `classifyProviderError` (`turn-data.ts`).
 * Recorded so a provider outage reads as one — not as the assistant failing
 * to answer, and not as the generic "could not produce a final response".
 */
export interface ProviderError {
  /** The provider's own message when it sent one, flattened and clipped; never a stack. */
  message: string;
  /** HTTP status of the failed call, when the error carried one. */
  statusCode?: number;
  kind: ProviderErrorKind;
}

/** The side passes a turn can make beyond the main agent run. */
export type SidePass =
  'grounding' | 'synthesis' | 'crossCheck' | 'review' | 'fixer';

export interface RunTurnOptions {
  /** Streaming sink; chat passes one, harnesses usually do not. */
  emit?: (event: StreamEvent) => void;
  abortSignal?: AbortSignal;
  activeVisualId?: string;
  /** Overrides over the production defaults (Settings → Engine levers). */
  engine?: Partial<EngineOptions>;
  /**
   * The eval case's category, when a harness runs the turn — drives
   * `careful: 'auto'` (`RISKY_CATEGORIES`). Chat turns have none.
   */
  category?: string;
  /** The eval arm this turn ran under, recorded on the persisted message. */
  arm?: string;
  /**
   * Business expert mode: cross-check the answer, then attach a reasoning
   * trace (`expert-status` progress events). Never on by default.
   */
  expert?: boolean;
  /**
   * Answer pinning: replay a pinned answer whose SQL still returns the same
   * rows, and pin an eligible fresh one. Off by default — only the chat
   * controller turns it on; an eval harness leaves it off so a graded turn
   * measures the engine, never a cache.
   */
  pin?: boolean;
  /**
   * Learning-memory signals from this turn (a cross-check that disagreed,
   * ADR-0013). Off by default — only chat (`streamMessage`) turns it on, so
   * an eval arm may recall from the memory but never writes to it.
   */
  memorySignals?: boolean;
}

export interface TurnResult {
  /** The FINAL answer text: after tool-only synthesis, the grounding guard and the review. */
  text: string;
  /** What was persisted; absent when the turn was aborted before persisting. */
  message?: ChatMessage;
  /** Every captured tool record, side passes included, in capture order. */
  data: ToolDataRecord[];
  /** Tool names in call order (repeats kept), `ask_clarification` included. */
  calledTools: string[];
  /** Number of tool calls the turn made. */
  steps: number;
  /** The last successful `run_readonly_sql` statement — the SQL the answer used. */
  finalSql?: string;
  clarification?: ChatMessage['clarification'];
  crossCheck?: CrossCheck;
  review?: AnswerReview;
  /** Every auto-repair the fixer made this turn. */
  repairs: SqlRepairRecord[];
  /** Result-guard and precheck warnings, deduplicated, in first-seen order. */
  warnings: string[];
  /**
   * Main run plus every side pass that reported usage. Absent when nothing
   * was observed — which is not the same as free (`eval-telemetry.ts`).
   */
  usage?: TokenUsage;
  /** The side passes' share of `usage`, per pass. */
  sidePassUsage?: Partial<Record<SidePass, TokenUsage>>;
  /** The levers this turn actually ran with (defaults + overrides, resolved). */
  engine: EngineOptions;
  /** `engineConfigHash(engine, { model, reasoningEffort })`. */
  configHash: string;
  aborted: boolean;
  durationMs: number;
  /**
   * Set when the model provider failed during the turn's main run (quota,
   * rate limit, auth, network, timeout). A turn that produced no answer
   * because of it carries an honest message as `text` instead of an answer,
   * and a harness must treat it as an ERROR — the engine was never measured.
   */
  providerError?: ProviderError;
}
