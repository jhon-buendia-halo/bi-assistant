import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  checkStageCounts,
  foreignTable,
  sampleExplanation,
} from '../../../mastra/agents/query-explainer.prompts';
import { MastraService } from '../../../mastra/mastra.service';
import { runErrorMessage } from '../../../mastra/workflows/workflow-run';
import type { ChatMessage, ToolDataRecord } from '../entities/session.entity';
import { evidenceOf } from './query-evidence';
import type {
  QueryEvidenceService,
  QueryExport,
  QueryRerunResult,
} from './query-evidence.service';
import { QUERY_EVIDENCE_SERVICE } from './query-evidence.token';
import type { QueryEvidence, QueryExplanation } from './query-evidence.types';

/**
 * An answer as its host holds it right now, read by `AnswerHost.load`:
 * the answer, the datasets its queries may read, the host's view of it
 * (what an endpoint answers when nothing was written), and how to write a
 * changed answer back (answering the host's view after the write).
 */
export interface LoadedAnswer<V> {
  answer: ChatMessage;
  datasets: string[];
  view(): Promise<V>;
  save(answer: ChatMessage): Promise<V>;
}

/**
 * Where an answer lives (plan section 5): a stored run, a draft run held in
 * memory, a session's message. `key` names the lock and the single flight;
 * `load` raises the host's own 404 and 400; `owner` names the host in the
 * texts (`Query <index> not found in the <owner>'s answer`).
 */
export interface AnswerHost<V> {
  key: string;
  owner: string;
  load(): Promise<LoadedAnswer<V>>;
}

/** The answer's evidence, derived from `data` when it predates the feature. */
function evidenceIn(answer: ChatMessage): QueryEvidence[] {
  return answer.evidence ?? evidenceOf(answer.data ?? []);
}

/**
 * The query inspector's engine (api.md 139-148): the lock per answer, the
 * single flight, prepare, explain, count the steps, re-run and export, on
 * any answer host. Queries go through `QueryEvidenceService`, the explainer
 * through `MastraService.explainQuery`. It stores nothing itself: every
 * write goes through the host's `save`, under the host's lock.
 */
@Injectable()
export class AnswerEvidenceService {
  constructor(
    // A token keeps the service import type-only (no connector drivers).
    @Inject(QUERY_EVIDENCE_SERVICE)
    private readonly queryEvidence: QueryEvidenceService,
    private readonly mastra: MastraService,
  ) {}

  /**
   * The tail of each answer's writes: every write to an answer waits for
   * the one before, so two cannot overwrite each other.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  /** Calls in flight by kind, host and index: a repeat waits for the same result. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` holding the lock `key`: one write at a time per key, in call
   * order; a failed write does not block the next. Not re-entrant: never
   * take the same key (or call `patchEvidence` on the same host) inside `fn`.
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(key) ?? Promise.resolve();
    const current = before.then(fn, fn);
    const tail = current.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private once<V>(key: string, work: () => Promise<V>): Promise<V> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<V>;
    const started = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }

  /**
   * Merge `patch` into the evidence entry `index` of the host's answer,
   * under its lock (plan 3c: re-read, patch one entry, write the answer).
   */
  patchEvidence<V>(
    host: AnswerHost<V>,
    index: number,
    patch: Partial<Omit<QueryEvidence, 'index'>>,
  ): Promise<V> {
    return this.withLock(host.key, async () => {
      const loaded = await host.load();
      const evidence = evidenceIn(loaded.answer);
      const entry = this.evidenceAt(host, evidence, index);
      const next = evidence.map((e) =>
        e === entry ? { ...e, ...patch, index: e.index } : e,
      );
      return loaded.save({ ...loaded.answer, evidence: next });
    });
  }

  /**
   * Build the evidence of an answer stored before the feature and size its
   * tables (api.md 139, 144). With nothing missing it runs no query and
   * writes nothing.
   */
  prepare<V>(host: AnswerHost<V>): Promise<V> {
    return this.withLock(host.key, async () => {
      const loaded = await host.load();
      const evidence = await this.queryEvidence.prepare(
        loaded.answer,
        loaded.datasets,
      );
      if (!evidence) return loaded.view();
      return loaded.save({ ...loaded.answer, evidence });
    });
  }

  /**
   * Explain one query step by step (api.md 140, 145). Returns the stored
   * explanation when there is one; a `sample_rows` record is explained by
   * code, any other by one call to `query-explainer`. A second request for
   * the same host and index while one runs waits for the same result.
   */
  explain<V>(host: AnswerHost<V>, index: number): Promise<V> {
    return this.once(`explain:${host.key}:${index}`, async () => {
      // The table sizes the explainer's request holds (idempotent; takes the
      // lock itself, so it runs before ours, never inside one).
      await this.prepare(host);
      const loaded = await host.load();
      const { answer } = loaded;
      const entry = this.evidenceAt(host, evidenceIn(answer), index);
      if (entry.explanation) return loaded.view();
      const record = (answer.data ?? [])[index];
      if (!record || record.error || !record.input?.trim()) {
        throw new BadRequestException(`Query ${index} has no SQL to explain`);
      }
      let explanation: QueryExplanation;
      if (record.tool === 'sample_rows') {
        explanation = sampleExplanation(record, entry);
      } else {
        try {
          explanation = await this.mastra.explainQuery({
            record,
            evidence: entry,
          });
        } catch (error) {
          throw new BadRequestException(
            `The query could not be explained: ${runErrorMessage(error)}`,
          );
        }
      }
      return this.patchEvidence(host, index, { explanation });
    });
  }

  /**
   * Count the rows after each step of an explained query (api.md 141, 146).
   * Each statement runs through `QueryEvidenceService.countRows`, in turn,
   * and only when every statement reads tables the original query reads;
   * `checkStageCounts` decides alone whether the counts are stored. A failed
   * check is stored as `unverified`, not raised. Once verified, the stored
   * result is returned.
   */
  countSteps<V>(host: AnswerHost<V>, index: number): Promise<V> {
    return this.once(`counts:${host.key}:${index}`, async () => {
      const loaded = await host.load();
      const { answer, datasets } = loaded;
      const entry = this.evidenceAt(host, evidenceIn(answer), index);
      const explanation = entry.explanation;
      if (!explanation) {
        throw new BadRequestException(`Explain query ${index} first`);
      }
      if (explanation.stageCounts?.status === 'verified') return loaded.view();
      const record = (answer.data ?? [])[index];
      const unverified = (reason: string) =>
        this.patchEvidence(host, index, {
          explanation: {
            ...explanation,
            stageCounts: {
              status: 'unverified',
              at: new Date().toISOString(),
              reason,
            },
          },
        });
      const steps = explanation.steps.filter((s) => s.verb !== 'show');
      const tables = entry.tables ?? [];
      if (record?.tool === 'sample_rows') {
        return unverified('A sample of rows has no steps to count');
      }
      if (!tables.length)
        return unverified('The tables the query reads are not known');
      const entities = tables.map((t) => t.entity);
      for (const [i, step] of steps.entries()) {
        if (!step.countSql) {
          return unverified(
            `Step ${i + 1} (${step.verb}) has no count statement`,
          );
        }
        const foreign = foreignTable(step.countSql, entities);
        if (foreign) {
          return unverified(
            `Step ${i + 1} (${step.verb}) reads ${foreign}, which the query does not read`,
          );
        }
      }
      const source = await this.queryEvidence.datasourceFor(entry, datasets);
      const counts: number[] = [];
      for (const [i, step] of steps.entries()) {
        try {
          counts.push(
            await this.queryEvidence.countRows(
              source.id,
              step.countSql as string,
            ),
          );
        } catch (error) {
          return unverified(
            `Step ${i + 1} (${step.verb}) could not be counted: ${runErrorMessage(error)}`,
          );
        }
      }
      const check = checkStageCounts({
        steps,
        counts,
        tables,
        outerLimit: entry.outerLimit,
        totalRows: entry.totalRows,
        rowCount: record.rowCount ?? record.rows?.length ?? 0,
        truncated: record.truncated,
      });
      if (check.status === 'unverified') return unverified(check.reason);
      let next = 0;
      return this.patchEvidence(host, index, {
        explanation: {
          ...explanation,
          steps: explanation.steps.map((s) =>
            s.verb === 'show' ? s : { ...s, rows: counts[next++] },
          ),
          stageCounts: { status: 'verified', at: new Date().toISOString() },
        },
      });
    });
  }

  /** Run one of the answer's queries again; nothing is stored (api.md 142, 147). */
  async rerun<V>(
    host: AnswerHost<V>,
    index: number,
  ): Promise<QueryRerunResult> {
    const { record, entry, datasets } = await this.runnableQuery(host, index);
    return this.queryEvidence.rerun(record, entry, datasets);
  }

  /**
   * One query's rows for a CSV (api.md 143, 148): up to 50,000, `cut` when
   * more existed; `q` is the query's number in the answer (1-based).
   */
  async exportRows<V>(
    host: AnswerHost<V>,
    index: number,
  ): Promise<QueryExport & { q: number }> {
    const { record, entry, evidence, datasets } = await this.runnableQuery(
      host,
      index,
    );
    const exported = await this.queryEvidence.exportRows(
      record,
      entry,
      datasets,
    );
    return { ...exported, q: evidence.indexOf(entry) + 1 };
  }

  private evidenceAt<V>(
    host: AnswerHost<V>,
    evidence: QueryEvidence[],
    index: number,
  ): QueryEvidence {
    const entry = evidence.find((e) => e.index === index);
    if (!entry) {
      throw new BadRequestException(
        `Query ${index} not found in the ${host.owner}'s answer`,
      );
    }
    return entry;
  }

  /** The checks of 142 and 143: a query of the answer with SQL to run. */
  private async runnableQuery<V>(
    host: AnswerHost<V>,
    index: number,
  ): Promise<{
    record: ToolDataRecord;
    entry: QueryEvidence;
    evidence: QueryEvidence[];
    datasets: string[];
  }> {
    const { answer, datasets } = await host.load();
    const evidence = evidenceIn(answer);
    const entry = this.evidenceAt(host, evidence, index);
    const record = (answer.data ?? [])[index];
    if (!record || record.error || !record.input?.trim()) {
      throw new BadRequestException(`Query ${index} has no SQL to run`);
    }
    return { record, entry, evidence, datasets };
  }
}
