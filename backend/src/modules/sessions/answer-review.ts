import { z } from 'zod';
import type {
  AnswerReview,
  AnswerReviewCode,
  AnswerReviewFinding,
} from './turn-result';
import { extractUsageDeep, type TokenUsage } from '../agents/eval-telemetry';

/**
 * L4 Stage C0 `answerReview`: one review call over the finished transcript
 * against the eight Omni error classes (`AnswerReviewCode`) — unsupported
 * claims, missed date filters, truncation reported as complete, prose
 * arithmetic, comparison-window mistakes, ignored breakdowns, degenerate
 * queries, metric/filter mismatches — followed by one corrective pass when
 * it finds something (engineering plan §5 L4 Stage C0, §9.7).
 *
 * **Pure module.** No `@mastra/core` import, so it stays importable by Jest
 * without a mock. `answer-review.agent.ts` imports `answerReviewOutputSchema`
 * FROM this file rather than the reverse — `@mastra/core/agent` pulls in
 * ESM-only transitive deps Jest's CommonJS transform cannot load (the same
 * constraint `assistant-instructions.ts` documents for the assistant agent).
 * `ReviewAgentLike` is the structural type that keeps this file decoupled
 * from the real `Agent` class; `answer-review.agent.ts` satisfies it.
 *
 * `reviewAnswer` is called by `SessionsService`/`runTurn` (U1-A) after the
 * grounding guard and before the cross-check; on a `nudge`, the caller runs
 * one corrective pass itself (same shape as `runGroundingGuard`) and marks
 * the result `revised`. `reviewNudge` is pure text over the findings —
 * nothing here depends on the review agent having run.
 */

/** What the review judges — assembled from the finished turn, not re-derived from raw messages. */
export interface AnswerReviewInput {
  question: string;
  finalText: string;
  sql: { sql: string; ok: boolean; error?: string; rowCount?: number }[];
  resultShape?: string;
  warnings: string[];
  metricsBlock?: string;
  defaultFilters?: string[];
}

/** The minimal surface `reviewAnswer` needs from a Mastra agent — `answer-review.agent.ts` (U1-H) satisfies it. */
export interface ReviewAgentLike {
  generate(input: string, options: Record<string, unknown>): Promise<unknown>;
}

/** The eight codes as a zod enum, kept in sync with `AnswerReviewCode` by `satisfies`. */
const ANSWER_REVIEW_CODES = [
  'unsupported-claim',
  'date-filter',
  'truncated-as-complete',
  'prose-arithmetic',
  'comparison-window',
  'ignored-breakdown',
  'degenerate-query',
  'metric-or-filter-mismatch',
] as const satisfies readonly AnswerReviewCode[];

/**
 * The review agent's structured output. A finding needs concrete evidence
 * quoted in `detail`; `ok: true` (empty `findings`) means nothing is wrong;
 * `confidence: 'low'` marks a finding the review itself is not sure of —
 * `reviewAnswer` keeps it for the record but never lets it trigger a rewrite.
 */
export const answerReviewOutputSchema = z.object({
  ok: z
    .boolean()
    .describe('True when the answer has no issues against its own evidence'),
  findings: z
    .array(
      z.object({
        code: z.enum(ANSWER_REVIEW_CODES),
        detail: z
          .string()
          .describe(
            'Concrete evidence for the finding, quoting the answer text or a result — never a guess',
          ),
      }),
    )
    .describe('Empty when ok is true'),
  confidence: z
    .enum(['high', 'low'])
    .describe(
      'How sure the review is of every finding; low never triggers a rewrite',
    ),
});

export type AnswerReviewOutput = z.infer<typeof answerReviewOutputSchema>;

/* --------------------------------------------------------- prompt budget */
// Each section is clipped on its own so one runaway field (a huge warnings
// list, a very long answer) cannot crowd out the rest — the totals below sum
// to a compact ~6,000 chars, plenty for a review that only has to read the
// evidence already collected, not re-derive anything.

const QUESTION_CHARS = 400;
const FINAL_TEXT_CHARS = 1500;
const SQL_STATEMENT_CHARS = 500;
const SQL_SECTION_CHARS = 2500;
const RESULT_SHAPE_CHARS = 300;
const WARNINGS_CHARS = 500;
const METRICS_CHARS = 800;
const DEFAULT_FILTERS_CHARS = 300;
/** Chip-tooltip note length — matches `sessions.service.ts`'s `CROSS_CHECK_NOTE_CHARS`. */
const NOTE_CHARS = 220;

/** Clip free text to `max` chars, marking the cut with an ellipsis. */
function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** One line per executed statement, filling `SQL_SECTION_CHARS` best-first. */
function sqlSection(records: AnswerReviewInput['sql']): string {
  if (!records.length) return '(no SQL was executed this turn)';
  const lines: string[] = [];
  let used = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const status = record.ok
      ? `ok, ${record.rowCount ?? 'unknown'} row(s)`
      : `FAILED: ${clip(record.error ?? 'unknown error', 200)}`;
    const line = `${i + 1}. [${status}] ${clip(record.sql, SQL_STATEMENT_CHARS)}`;
    if (used + line.length > SQL_SECTION_CHARS) {
      lines.push(`… and ${records.length - i} more statement(s) omitted`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

/**
 * The compact, tag-delimited prompt `reviewAnswer` sends. Data only — the
 * rubric (the eight error classes, "judge only what's given") lives in the
 * agent's own instructions, not repeated here.
 */
export function buildReviewPrompt(input: AnswerReviewInput): string {
  const lines: string[] = [
    '<question>',
    clip(input.question, QUESTION_CHARS),
    '</question>',
    '',
    '<final-answer>',
    clip(input.finalText, FINAL_TEXT_CHARS),
    '</final-answer>',
    '',
    '<sql>',
    sqlSection(input.sql),
    '</sql>',
  ];
  if (input.resultShape) {
    lines.push(
      '',
      '<result-shape>',
      clip(input.resultShape, RESULT_SHAPE_CHARS),
      '</result-shape>',
    );
  }
  if (input.warnings.length) {
    lines.push(
      '',
      '<warnings>',
      clip(input.warnings.join('\n'), WARNINGS_CHARS),
      '</warnings>',
    );
  }
  if (input.metricsBlock) {
    lines.push(
      '',
      '<metrics>',
      clip(input.metricsBlock, METRICS_CHARS),
      '</metrics>',
    );
  }
  if (input.defaultFilters?.length) {
    lines.push(
      '',
      '<default-filters>',
      clip(input.defaultFilters.join('\n'), DEFAULT_FILTERS_CHARS),
      '</default-filters>',
    );
  }
  return lines.join('\n');
}

/**
 * Parse a model's JSON reply, tolerating a markdown fence around it. Mirrors
 * `sessions.service.ts`'s private helper of the same name — this pure
 * module cannot import that Nest-graph file, so the (small, stable) parser
 * is duplicated rather than shared.
 */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}

/** Short line for the `flagged` chip's tooltip. */
function flaggedNote(findings: AnswerReviewFinding[]): string {
  const codes = [...new Set(findings.map((finding) => finding.code))];
  const summary = `review flagged ${findings.length === 1 ? '1 issue' : `${findings.length} issues`}: ${codes.join(', ')}`;
  return clip(summary, NOTE_CHARS);
}

/**
 * Runs the review agent over `input` and returns its verdict, usage (when
 * observed) and, on a finding worth acting on, the system text for a
 * corrective pass. Never throws — a review failure must surface as
 * `status: 'error'`, never lose the answer it was reviewing.
 */
export async function reviewAnswer(
  agent: ReviewAgentLike,
  input: AnswerReviewInput,
  options: {
    providerOptions?: Record<string, unknown>;
    abortSignal?: AbortSignal;
  },
): Promise<{ review: AnswerReview; usage?: TokenUsage; nudge?: string }> {
  let result: unknown;
  try {
    result = await agent.generate(buildReviewPrompt(input), {
      maxSteps: 1,
      toolChoice: 'none',
      providerOptions: options.providerOptions,
      abortSignal: options.abortSignal,
      structuredOutput: {
        schema: answerReviewOutputSchema,
        jsonPromptInjection: 'inline',
      },
    });
  } catch (error) {
    // An abort is an expected shutdown, not a fault — report it plainly,
    // with no error detail to turn into log/UI noise.
    if (options.abortSignal?.aborted) {
      return { review: { status: 'error', findings: [] } };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      review: {
        status: 'error',
        findings: [],
        note: clip(`review call failed: ${detail}`, NOTE_CHARS),
      },
    };
  }

  // Read usage off the call even when the reply below turns out unparseable
  // — a review that spent tokens without producing a usable verdict still
  // spent tokens (eval-telemetry's "missing usage is not zero usage" rule
  // is about calls that report nothing back, not about calls we choose not
  // to read; this one we can read, so we do).
  const usage = extractUsageDeep(result);
  const raw = result as { object?: unknown; text?: string } | undefined;
  const parsed = answerReviewOutputSchema.safeParse(
    raw?.object ?? parseJsonObject(raw?.text),
  );
  if (!parsed.success) {
    return {
      review: {
        status: 'error',
        findings: [],
        note: 'review response could not be parsed',
      },
      usage,
    };
  }

  const { ok, findings, confidence } = parsed.data;
  if (ok || findings.length === 0) {
    return { review: { status: 'ok', findings: [] }, usage };
  }
  if (confidence === 'low') {
    // Kept on the record (report/eval visibility) but never rewrites the
    // answer — a review that is not sure of its own finding is not worth
    // the extra pass, or the risk of a confidently-wrong "correction".
    return { review: { status: 'ok', findings }, usage };
  }
  return {
    review: { status: 'flagged', findings, note: flaggedNote(findings) },
    usage,
    nudge: reviewNudge(findings),
  };
}

/** System text for the one corrective pass a review with findings triggers. */
export function reviewNudge(findings: AnswerReviewFinding[]): string {
  if (!findings.length) return '';
  return [
    'An independent review of the answer you just gave found issues, judged',
    'against the results you already have. Correct the answer — call your',
    'tools again for fresh results if you need to — keep whatever was',
    'already right, and give the corrected answer in the same reply. Do not',
    'mention this review to the user:',
    ...findings.map((finding) => `- [${finding.code}] ${finding.detail}`),
  ].join('\n');
}
