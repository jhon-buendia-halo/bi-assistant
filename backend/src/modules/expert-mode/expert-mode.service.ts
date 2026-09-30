import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { MastraService } from '../../mastra/mastra.service';
import { pickAnswerRecord } from './answer-record';
import { lastAgentModelId } from '../../mastra/model-resolver';
import { referenceSuffix } from '../../mastra/context-blocks';
import {
  businessExpertOutputSchema,
  type BusinessExpertOutput,
  type EXPERT_EVIDENCE_BASES,
  type EXPERT_TABLE_ROLES,
} from '../../mastra/agents/business-expert.agent';
import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type {
  CrossCheck,
  ToolDataRecord,
} from '../sessions/entities/session.entity';
import {
  BLOCK_SIGNAL_WEIGHTS,
  assumptionLoadMeasurement,
  blockConfidence,
  coverageMeasurement,
  crossCheckMeasurement,
  executionMeasurement,
  joinGroundingMeasurement,
  makeSignal,
  overallConfidence,
  schemaGroundingMeasurement,
  selfReportMeasurement,
  verifiedMeasurement,
  type Measurement,
} from './confidence';
import {
  analyzeSql,
  joinIsGrounded,
  locateVerbatim,
  nameParts,
  resolveEntityKey,
  type SqlGrounding,
} from './sql-grounding';
import {
  ReasoningFeedbackRepository,
  type ReasoningFeedbackContext,
  type ReasoningFeedbackKey,
  type ReasoningFeedbackPatch,
} from './repositories/reasoning-feedback.repository';
import type {
  Assumption,
  AssumptionsBlock,
  ConfidenceSignal,
  DataSelectionBlock,
  EvidenceBasis,
  InterpretationBlock,
  JoinEdge,
  MetricBlock,
  ReasoningBlock,
  ReasoningFeedbackDoc,
  ReasoningTrace,
  RejectedEntity,
  SqlAnnotation,
  SqlBlock,
  TableChoice,
  TableRole,
  TermMapping,
} from './entities/reasoning-trace.entity';

// The agent file mirrors the contract's enums (it carries no feature-module
// imports); these fail to compile the moment the two lists drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const basesInStep: Same<(typeof EXPERT_EVIDENCE_BASES)[number], EvidenceBasis> =
  true;
const rolesInStep: Same<(typeof EXPERT_TABLE_ROLES)[number], TableRole> = true;
void basesInStep;
void rolesInStep;

export const BUSINESS_EXPERT_AGENT_ID = 'business-expert';

/** Everything the expert pass needs, gathered by `SessionsService` at persist time. */
export interface TraceInput {
  sessionId: string;
  question: string;
  /** The answer text as it will be saved. */
  answer: string;
  /** The turn's captured tool records — the only source of SQL in the trace. */
  data: ToolDataRecord[];
  /** Every bound entity of the session's datasets. */
  entities: DatasetEntitySnapshot[];
  /** The curated knowledge the turn was given. */
  knowledgeUsed: KnowledgeUse[];
  /** The governed-metrics system block the turn was given. */
  metricsBlock?: string;
  /** The verified-reference-queries system block the turn was given. */
  verifiedBlock?: string;
  /** The final SQL matches a user-approved verified query. */
  verified: boolean;
  /** Careful mode's independent re-derivation verdict, when it ran. */
  crossCheck?: CrossCheck;
  /** Statements the SQL fixer repaired before they ran (the corrected text). */
  repairedSql?: string[];
  abortSignal?: AbortSignal;
}

/** Character budget for the schema section of the explainer prompt. */
const SCHEMA_CHARS = 6_000;
const ANSWER_CHARS = 4_000;
/** The final statement is passed whole up to here — annotations quote it. */
const FINAL_SQL_CHARS = 12_000;
/** Earlier queries shown as exploration steps (the most recent ones). */
const EXPLORATION_STEPS = 8;
const EXPLORATION_SQL_CHARS = 600;
const SAMPLE_ROWS = 5;
const CELL_CHARS = 80;
const KNOWLEDGE_CHARS = 4_000;
const CONTEXT_BLOCK_CHARS = 4_000;
/** One authoring call, plus one retry carrying the validation error. */
const AUTHOR_ATTEMPTS = 2;
const RETRY_ERROR_CHARS = 1_500;
const REFERENCED_BY_QUERY = 'Referenced by the query';
/** Bases that name a curated source and so must be checked against it. */
const SOURCED_BASES = ['knowledge', 'metric', 'verified_query'] as const;
type SourcedBasis = (typeof SOURCED_BASES)[number];

/**
 * Business expert mode: turns a finished answer into a `ReasoningTrace`.
 *
 * The `business-expert` agent writes the prose and the structure; this
 * service owns everything that must be true rather than plausible. The SQL
 * and its row count come from the turn's records, tables and joins are
 * reconciled with what the statement actually reads, a curated-source claim
 * that names no source in the context is downgraded, and every confidence is
 * computed from measured signals (`confidence.ts`). An explanation that
 * cannot be produced is skipped — the answer is never blocked by it.
 */
@Injectable()
export class ExpertModeService {
  private readonly logger = new Logger(ExpertModeService.name);

  constructor(
    private readonly mastra: MastraService,
    private readonly feedback: ReasoningFeedbackRepository,
  ) {}

  /**
   * One structured explainer call (plus one retry on an unusable reply),
   * then deterministic post-processing and scoring. `undefined` when the
   * model could not produce a usable explanation or the turn was aborted.
   */
  async buildTrace(input: TraceInput): Promise<ReasoningTrace | undefined> {
    const final = pickAnswerRecord(input.data, input.answer);
    const grounding = final?.input
      ? analyzeSql(final.input, input.entities ?? [])
      : undefined;
    const output = await this.author(
      this.prompt(input, final, grounding),
      input.abortSignal,
    );
    if (!output || input.abortSignal?.aborted) return undefined;
    return this.assemble(input, output, final, grounding);
  }

  /** Upsert one block rating (PATCH semantics — see the repository). */
  saveFeedback(
    key: ReasoningFeedbackKey,
    context: ReasoningFeedbackContext,
    patch: ReasoningFeedbackPatch,
  ): Promise<ReasoningFeedbackDoc> {
    return this.feedback.upsert(key, context, patch);
  }

  /** Block ratings, newest first; optionally one session's only. */
  listFeedback(sessionId?: string): Promise<ReasoningFeedbackDoc[]> {
    return this.feedback.list(sessionId || undefined);
  }

  // ------------------------------------------------------------- authoring

  private async author(
    prompt: string,
    abortSignal: AbortSignal | undefined,
  ): Promise<BusinessExpertOutput | undefined> {
    let problem: string | undefined;
    for (let attempt = 1; attempt <= AUTHOR_ATTEMPTS; attempt++) {
      if (abortSignal?.aborted) return undefined;
      const text = problem
        ? [
            prompt,
            '',
            '<previous-reply-problem>',
            `Your previous reply could not be used: ${problem}`,
            'Reply again with only the JSON object that matches the schema.',
            '</previous-reply-problem>',
          ].join('\n')
        : prompt;
      try {
        const result = await this.mastra
          .getAgent(BUSINESS_EXPERT_AGENT_ID)
          .generate(text, {
            maxSteps: 1,
            toolChoice: 'none',
            providerOptions: { openai: { reasoningEffort: 'medium' } },
            structuredOutput: {
              schema: businessExpertOutputSchema,
              jsonPromptInjection: 'inline',
            },
            abortSignal,
          });
        const parsed = businessExpertOutputSchema.safeParse(
          withoutNulls(result.object ?? parseJsonObject(result.text)),
        );
        if (parsed.success) return parsed.data;
        problem = clip(z.prettifyError(parsed.error), RETRY_ERROR_CHARS);
      } catch (error) {
        if (abortSignal?.aborted) return undefined;
        problem = clip(
          error instanceof Error ? error.message : String(error),
          RETRY_ERROR_CHARS,
        );
      }
      this.logger.warn(
        `Reasoning trace attempt ${attempt} unusable: ${problem.split('\n')[0]}`,
      );
    }
    this.logger.warn(
      'Reasoning trace skipped: the explainer produced no usable reply',
    );
    return undefined;
  }

  /** The per-call prompt; the standing rules live in the agent's instructions. */
  private prompt(
    input: TraceInput,
    final: ToolDataRecord | undefined,
    grounding: SqlGrounding | undefined,
  ): string {
    const lines: string[] = [
      '<question>',
      input.question,
      '</question>',
      '',
      '<answer>',
      clip(input.answer, ANSWER_CHARS),
      '</answer>',
      '',
    ];
    if (final?.input) {
      const rows = final.rowCount ?? final.rows?.length ?? 0;
      lines.push(
        `<final-sql rows="${rows}"${final.truncated ? ' truncated="true"' : ''}>`,
        clip(final.input.trim(), FINAL_SQL_CHARS),
        '</final-sql>',
        '',
        '<final-result>',
        `columns: ${(final.columns ?? []).join(', ') || '(none)'}`,
        ...(final.rows ?? [])
          .slice(0, SAMPLE_ROWS)
          .map((row) => JSON.stringify(clipRow(row))),
        ...(final.warnings?.length
          ? [`result-guard warnings: ${final.warnings.join(' | ')}`]
          : []),
        '</final-result>',
      );
    } else {
      lines.push(
        '<final-sql>',
        '(no query ran successfully — omit dataSelection, metric and sql)',
        '</final-sql>',
      );
    }
    const earlier = input.data
      .filter((record) => record !== final)
      .slice(-EXPLORATION_STEPS);
    lines.push(
      '',
      '<exploration-steps>',
      ...(earlier.length
        ? earlier.map((record, index) => explorationLine(record, index + 1))
        : ['(none)']),
      '</exploration-steps>',
      '',
      '<schema>',
      schemaSection(input.entities ?? [], grounding?.entities ?? []) ||
        '(no schema snapshot stored for this session)',
      '</schema>',
      '',
      '<knowledge>',
      knowledgeSection(input.knowledgeUsed ?? []) || '(none)',
      '</knowledge>',
      '',
      '<metrics>',
      clip(input.metricsBlock?.trim() ?? '', CONTEXT_BLOCK_CHARS) || '(none)',
      '</metrics>',
      '',
      '<verified-queries>',
      clip(input.verifiedBlock?.trim() ?? '', CONTEXT_BLOCK_CHARS) || '(none)',
      '</verified-queries>',
    );
    return lines.join('\n');
  }

  // --------------------------------------------------------- post-processing

  private assemble(
    input: TraceInput,
    output: BusinessExpertOutput,
    final: ToolDataRecord | undefined,
    grounding: SqlGrounding | undefined,
  ): ReasoningTrace {
    const entities = input.entities ?? [];
    const sql = final?.input?.trim();
    const pools = sourcePools(input);
    const verify = (basis: EvidenceBasis, sourceRef?: string) =>
      verifyBasis(basis, sourceRef, pools);

    // ---- interpretation
    const terms: TermMapping[] = output.interpretation.terms
      .filter((term) => term.term?.trim() && term.mappedTo?.trim())
      .map((term) => {
        const checked = verify(term.basis, term.sourceRef);
        return {
          term: term.term.trim(),
          mappedTo: term.mappedTo.trim(),
          basis: checked.basis,
          ...(checked.sourceRef ? { sourceRef: checked.sourceRef } : {}),
        };
      });

    // ---- assumptions, renumbered a1..aN so annotations can point at them
    const idMap = new Map<string, string>();
    const items: Assumption[] = [];
    for (const item of output.assumptions.items) {
      const statement = item.statement?.trim();
      if (!statement) continue;
      const id = `a${items.length + 1}`;
      const original = (item.id ?? '').trim().toLowerCase();
      if (original && !idMap.has(original)) idMap.set(original, id);
      const checked = verify(item.basis, item.sourceRef);
      const fragment = item.sqlFragment?.trim();
      const alternative = item.alternative?.trim();
      items.push({
        id,
        statement,
        ...(fragment
          ? {
              sqlFragment: (sql && locateVerbatim(sql, fragment)) || fragment,
            }
          : {}),
        basis: checked.basis,
        ...(checked.sourceRef ? { sourceRef: checked.sourceRef } : {}),
        ...(alternative ? { alternative } : {}),
      });
    }

    // ---- measured signals
    const execution = executionMeasurement(
      final
        ? {
            ran: true,
            repaired: (input.repairedSql ?? []).some(
              (statement) => statement.trim() === sql,
            ),
            truncated: !!final.truncated,
            rowCount: final.rowCount ?? final.rows?.length ?? 0,
            warnings: final.warnings?.length ?? 0,
          }
        : { ran: false },
    );
    const schema = grounding
      ? schemaGroundingMeasurement({
          tables: {
            found: grounding.entities.length,
            total: grounding.entities.length + grounding.unknownTables.length,
          },
          columns: {
            found: grounding.columns.filter((c) => c.exists).length,
            total: grounding.columns.length,
          },
        })
      : undefined;
    const joinsMeasured = grounding
      ? joinGroundingMeasurement({
          grounded: grounding.joins.filter((j) => j.grounded).length,
          measured: grounding.joins.length,
          unverifiable: grounding.unverifiableJoins,
        })
      : undefined;
    const cross = crossCheckMeasurement(input.crossCheck);
    const verified = verifiedMeasurement(input.verified);
    const termBases = terms.map((t) => t.basis);
    const itemBases = items.map((i) => i.basis);
    const assumptionsCoverage = coverageMeasurement(itemBases, 'assumptions');

    const blocks: ReasoningBlock[] = [];
    const interpretation: InterpretationBlock = {
      kind: 'interpretation',
      restatement:
        output.interpretation.restatement?.trim() || input.question.trim(),
      terms,
      ambiguities: output.interpretation.ambiguities
        .map((a) => a?.trim())
        .filter((a): a is string => !!a),
      confidence: blockConfidence('interpretation', {
        knowledge_coverage: coverageMeasurement(termBases, 'terms'),
        assumption_load: assumptionLoadMeasurement(termBases, 'terms'),
        self_report: selfReportMeasurement(
          output.interpretation.selfConfidence,
        ),
      }),
    };
    blocks.push(interpretation);

    if (sql && grounding) {
      const selection = this.dataSelection(output, grounding, entities);
      blocks.push({
        ...selection,
        confidence: blockConfidence('data-selection', {
          schema_grounding: schema,
          join_grounding: joinsMeasured,
          execution,
          cross_check: cross,
          self_report: selfReportMeasurement(
            output.dataSelection?.selfConfidence,
          ),
        }),
      });
    }

    const assumptions: AssumptionsBlock = {
      kind: 'assumptions',
      items,
      confidence: blockConfidence('assumptions', {
        knowledge_coverage: assumptionsCoverage,
        assumption_load: assumptionLoadMeasurement(itemBases, 'assumptions'),
        self_report: selfReportMeasurement(output.assumptions.selfConfidence),
      }),
    };
    blocks.push(assumptions);

    if (sql && output.metric?.name?.trim()) {
      const checked = verify(output.metric.basis, output.metric.sourceRef);
      const formula = output.metric.formula?.trim() ?? '';
      const metric: MetricBlock = {
        kind: 'metric',
        name: output.metric.name.trim(),
        formula: (formula && locateVerbatim(sql, formula)) || formula,
        grain: output.metric.grain?.trim() ?? '',
        basis: checked.basis,
        ...(checked.sourceRef ? { sourceRef: checked.sourceRef } : {}),
        confidence: blockConfidence('metric', {
          knowledge_coverage: coverageMeasurement(
            [checked.basis],
            'metric definition',
          ),
          cross_check: cross,
          verified_match: verified,
          execution,
          self_report: selfReportMeasurement(output.metric.selfConfidence),
        }),
      };
      blocks.push(metric);
    }

    if (sql) {
      const annotations: SqlAnnotation[] = [];
      for (const note of output.sql?.annotations ?? []) {
        const clause = locateVerbatim(sql, note.clause ?? '');
        const explanation = note.explanation?.trim();
        if (!clause || !explanation) continue;
        if (
          annotations.some(
            (a) => a.clause === clause && a.explanation === explanation,
          )
        ) {
          continue;
        }
        annotations.push({
          clause,
          explanation,
          assumptionIds: unique(
            (note.assumptionIds ?? [])
              .map((id) => idMap.get(String(id).trim().toLowerCase()))
              .filter((id): id is string => !!id),
          ),
        });
      }
      const block: SqlBlock = {
        kind: 'sql',
        sql,
        annotations,
        ...(final?.rowCount === undefined ? {} : { rowCount: final.rowCount }),
        confidence: blockConfidence('sql', {
          cross_check: cross,
          execution,
          schema_grounding: schema,
          verified_match: verified,
          self_report: selfReportMeasurement(output.sql?.selfConfidence),
        }),
      };
      blocks.push(block);
    }

    const overallSignals: ConfidenceSignal[] = [];
    const addOverall = (
      id: ConfidenceSignal['id'],
      measurement: Measurement | undefined,
      weight: number | undefined,
      suffix = '',
    ) => {
      if (!measurement || weight === undefined) return;
      overallSignals.push(
        makeSignal(
          id,
          { ...measurement, note: `${measurement.note}${suffix}` },
          weight,
        ),
      );
    };
    const sqlWeights = BLOCK_SIGNAL_WEIGHTS.sql;
    addOverall('execution', execution, sqlWeights.execution);
    addOverall(
      'cross_check',
      cross,
      sqlWeights.cross_check,
      input.crossCheck?.status === 'disagree'
        ? ' — caps the overall confidence at 50%'
        : '',
    );
    addOverall(
      'verified_match',
      verified,
      sqlWeights.verified_match,
      ' — floors the overall confidence at 85%',
    );
    addOverall('schema_grounding', schema, sqlWeights.schema_grounding);
    addOverall(
      'knowledge_coverage',
      assumptionsCoverage,
      BLOCK_SIGNAL_WEIGHTS.assumptions.knowledge_coverage,
    );

    const model = lastAgentModelId();
    return {
      id: randomUUID(),
      version: 1,
      blocks,
      overall: overallConfidence(blocks, {
        crossCheck: input.crossCheck?.status,
        verified: input.verified,
        signals: overallSignals,
      }),
      generatedAt: new Date().toISOString(),
      ...(model ? { model } : {}),
    };
  }

  /**
   * Reconcile the model's table story with what the statement actually
   * reads: unreferenced tables go, referenced ones it skipped are added as
   * lookups, joins keep only pairs between referenced tables (plus the
   * statement's own joins the model left out), and a rejected table cannot be
   * one the query uses.
   */
  private dataSelection(
    output: BusinessExpertOutput,
    grounding: SqlGrounding,
    entities: DatasetEntitySnapshot[],
  ): Omit<DataSelectionBlock, 'confidence'> {
    const referenced = grounding.entities;
    const byKey = new Map(entities.map((e) => [e.key, e]));
    const canonicalColumn = (key: string, column: string): string => {
      const bare = nameParts(column).at(-1) ?? '';
      return (
        byKey.get(key)?.columns.find((c) => c.name.toLowerCase() === bare)
          ?.name ??
        column.split('.').at(-1)?.trim() ??
        column
      );
    };
    const columnsUsed = (key: string, proposed: string[]): string[] => {
      const known = byKey.get(key)?.columns ?? [];
      const used: string[] = [];
      for (const column of proposed ?? []) {
        const bare = nameParts(column).at(-1);
        if (!bare) continue;
        if (known.length && !known.some((c) => c.name.toLowerCase() === bare)) {
          continue;
        }
        const name = canonicalColumn(key, column);
        if (!used.includes(name)) used.push(name);
      }
      for (const column of grounding.columnsByEntity[key] ?? []) {
        if (!used.includes(column)) used.push(column);
      }
      return used;
    };

    const tables: TableChoice[] = [];
    for (const choice of output.dataSelection?.tables ?? []) {
      const key = resolveEntityKey(choice.entity ?? '', referenced);
      if (!key || tables.some((t) => t.entity === key)) continue;
      tables.push({
        entity: key,
        role: choice.role,
        reason: choice.reason?.trim() || REFERENCED_BY_QUERY,
        columnsUsed: columnsUsed(key, choice.columnsUsed),
      });
    }
    for (const key of referenced) {
      if (tables.some((t) => t.entity === key)) continue;
      tables.push({
        entity: key,
        role: 'lookup',
        reason: REFERENCED_BY_QUERY,
        columnsUsed: columnsUsed(key, []),
      });
    }

    const joins: JoinEdge[] = [];
    const seen = new Set<string>();
    const joinId = (a: string, ac: string, b: string, bc: string) =>
      [`${a}.${ac}`, `${b}.${bc}`]
        .map((side) => side.toLowerCase())
        .sort()
        .join('=');
    for (const join of output.dataSelection?.joins ?? []) {
      const from = resolveEntityKey(join.from ?? '', referenced);
      const to = resolveEntityKey(join.to ?? '', referenced);
      if (!from || !to || !join.fromColumn?.trim() || !join.toColumn?.trim()) {
        continue;
      }
      const fromColumn = canonicalColumn(from, join.fromColumn);
      const toColumn = canonicalColumn(to, join.toColumn);
      const id = joinId(from, fromColumn, to, toColumn);
      if (seen.has(id)) continue;
      seen.add(id);
      const grounded = joinIsGrounded(
        { entity: from, column: fromColumn },
        { entity: to, column: toColumn },
        entities,
      );
      joins.push({
        from,
        fromColumn,
        to,
        toColumn,
        basis: joinBasis(join.basis, grounded),
      });
    }
    for (const join of grounding.joins) {
      const id = joinId(join.from, join.fromColumn, join.to, join.toColumn);
      if (seen.has(id)) continue;
      seen.add(id);
      joins.push({
        from: join.from,
        fromColumn: join.fromColumn,
        to: join.to,
        toColumn: join.toColumn,
        basis: join.grounded ? 'schema' : 'convention',
      });
    }

    const keys = entities.map((e) => e.key);
    const rejected: RejectedEntity[] = [];
    for (const entry of output.dataSelection?.rejected ?? []) {
      const key = resolveEntityKey(entry.entity ?? '', keys);
      const reason = entry.reason?.trim();
      if (!key || !reason || referenced.includes(key)) continue;
      if (rejected.some((r) => r.entity === key)) continue;
      rejected.push({ entity: key, reason });
    }

    return { kind: 'data-selection', tables, joins, rejected };
  }
}

// ------------------------------------------------------------------ helpers

/** The statement behind an answer: its last `run_readonly_sql` that did not fail. */
export function finalSqlRecord(
  data: ToolDataRecord[] | undefined,
): ToolDataRecord | undefined {
  const records = data ?? [];
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (
      record.tool === 'run_readonly_sql' &&
      !record.error &&
      record.input?.trim()
    ) {
      return record;
    }
  }
  return undefined;
}

interface SourcePools {
  knowledge: string[];
  metric: string[];
  verified_query: string[];
}

/** The titles a curated-source claim may cite, read off the turn's context. */
function sourcePools(input: TraceInput): SourcePools {
  const metric: string[] = [];
  for (const line of (input.metricsBlock ?? '').split('\n')) {
    // `- ${label} (${name}) on ${entity}: …` — see MetricsService.definitionBlock.
    const match = /^- (.+?) \(([a-z][a-z0-9_]*)\) on /.exec(line.trim());
    if (match) metric.push(match[1], match[2]);
  }
  const verified: string[] = [];
  for (const line of (input.verifiedBlock ?? '').split('\n')) {
    // `Q: ${question}` — see VerifiedQueriesService.referenceBlock.
    const match = /^Q: (.+)$/.exec(line.trim());
    if (match) verified.push(match[1]);
  }
  return {
    knowledge: (input.knowledgeUsed ?? []).map((k) => k.title).filter(Boolean),
    metric,
    verified_query: verified,
  };
}

const normalizeRef = (text: string): string =>
  text
    .toLowerCase()
    .replace(/["'`“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Case-insensitive substring either way; very short strings must be equal. */
function refMatches(ref: string, candidate: string): boolean {
  const a = normalizeRef(ref);
  const b = normalizeRef(candidate);
  if (!a || !b) return false;
  if (Math.min(a.length, b.length) < 3) return a === b;
  return a.includes(b) || b.includes(a);
}

/** The source a reference names: an exact match first, else a substring one. */
function matchedSource(ref: string, pool: string[]): string | undefined {
  const exact = pool.find((title) => normalizeRef(title) === normalizeRef(ref));
  return exact ?? pool.find((title) => refMatches(ref, title));
}

/**
 * A curated-source basis must name a source the turn was actually given; the
 * reference is then normalised to that source's exact title. A claim citing
 * a source of another kind is relabelled to that kind; a claim citing nothing
 * that exists is downgraded to `assumption`, keeping what it cited (marked
 * unverified) so the reader sees what was claimed.
 */
export function verifyBasis(
  basis: EvidenceBasis,
  sourceRef: string | undefined,
  pools: SourcePools,
): { basis: EvidenceBasis; sourceRef?: string } {
  const ref = sourceRef?.trim();
  if (!(SOURCED_BASES as readonly string[]).includes(basis)) {
    return ref ? { basis, sourceRef: ref } : { basis };
  }
  if (ref) {
    // A verified reference is shown as the source's own title — the model
    // sometimes cites "title: body" or a paraphrase that contains it.
    const claimed = basis as SourcedBasis;
    const own = matchedSource(ref, pools[claimed]);
    if (own) return { basis, sourceRef: own };
    for (const other of SOURCED_BASES) {
      if (other === claimed) continue;
      const found = matchedSource(ref, pools[other]);
      if (found) return { basis: other, sourceRef: found };
    }
  }
  return {
    basis: 'assumption',
    sourceRef: ref ? `${ref} (unverified)` : 'no source named (unverified)',
  };
}

/**
 * A join's basis as shown: a declared/inferred edge is `schema` whatever the
 * model said; without one, a claimed schema or curated basis cannot be
 * checked (joins carry no source) and becomes `convention`.
 */
function joinBasis(claimed: EvidenceBasis, grounded: boolean): EvidenceBasis {
  if (grounded) return 'schema';
  return claimed === 'data_sample' ||
    claimed === 'convention' ||
    claimed === 'assumption'
    ? claimed
    : 'convention';
}

/**
 * The schema section, within budget: the entities the final SQL reads get
 * `name type` columns and join edges; the other bound entities get their key
 * and column names only.
 */
export function schemaSection(
  entities: DatasetEntitySnapshot[],
  referenced: string[],
  budget = SCHEMA_CHARS,
): string {
  const lines: string[] = [];
  let remaining = budget;
  const push = (line: string): boolean => {
    if (line.length + 1 > remaining) return false;
    lines.push(line);
    remaining -= line.length + 1;
    return true;
  };
  const used = referenced
    .map((key) => entities.find((e) => e.key === key))
    .filter((e): e is DatasetEntitySnapshot => !!e);
  const others = entities.filter((e) => !referenced.includes(e.key));
  if (used.length) {
    push(
      'Entities the final SQL reads (column type; -> declared join, ~> inferred join):',
    );
    for (const entity of used) {
      const line = `${entity.key}(${(entity.columns ?? [])
        .map((c) => `${c.name} ${c.type}${referenceSuffix(c)}`)
        .join(', ')})`;
      if (push(line)) continue;
      // Clip rather than drop: the tables the query reads matter most.
      if (remaining > 40) push(`${line.slice(0, remaining - 3)}…)`);
    }
  }
  let omitted = 0;
  for (const [index, entity] of others.entries()) {
    if (index === 0) {
      push("Other entities in the session's datasets (column names only):");
    }
    const names = (entity.columns ?? []).map((c) => c.name).join(', ');
    if (!push(`${entity.key}: ${names || '(columns not snapshotted)'}`)) {
      omitted++;
    }
  }
  if (omitted) lines.push(`(${omitted} more entities not shown)`);
  return lines.join('\n');
}

function knowledgeSection(knowledge: KnowledgeUse[]): string {
  const lines: string[] = [];
  let remaining = KNOWLEDGE_CHARS;
  for (const snippet of knowledge) {
    // Title and body on labelled fields, so a citation can name the title alone.
    const line = `- title: ${snippet.title} | kind: ${snippet.kind} | body: ${snippet.body.replace(/\s+/g, ' ').trim()}`;
    if (line.length > remaining) continue;
    lines.push(line);
    remaining -= line.length;
  }
  return lines.join('\n');
}

function explorationLine(record: ToolDataRecord, step: number): string {
  const outcome = record.error
    ? `error: ${clip(record.error.replace(/\s+/g, ' '), 200)}`
    : `${record.rowCount ?? record.rows?.length ?? 0} rows`;
  return [
    `${step}. ${record.tool}${record.rationale ? ` — ${record.rationale}` : ''}`,
    `   ${clip((record.input ?? '').replace(/\s+/g, ' ').trim(), EXPLORATION_SQL_CHARS)}`,
    `   → ${outcome}`,
  ].join('\n');
}

function clipRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [
      key,
      typeof value === 'string' ? clip(value, CELL_CHARS) : value,
    ]),
  );
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/** Drop `null`s so optional schema fields accept a model's explicit nulls. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== null).map(withoutNulls);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, withoutNulls(v)]),
    );
  }
  return value;
}

/** Parse a model's JSON reply, tolerating a markdown fence around it. */
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
