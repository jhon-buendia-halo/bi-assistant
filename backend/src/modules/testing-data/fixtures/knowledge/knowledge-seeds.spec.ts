import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWLEDGE_SNIPPET_KINDS } from '../../../knowledge/entities/knowledge-snippet.entity';
import type { MetricDoc } from '../../../metrics/entities/metric.entity';
import { MetricsService } from '../../../metrics/metrics.service';
import { SAMPLE_FIXTURES, type SampleFixture } from '../registry';
import type { KnowledgeSeed, SeedKnowledgeEntry, SeedMetric } from './types';

/**
 * The knowledge seeds the domain samples ship (testing-data R26, R27),
 * checked without a database or a running app: every entry is something the
 * knowledge and metrics services accept, names only its own sample's tables
 * and real columns, and gives away no eval question.
 *
 * R27's third rule (no entry settles an ambiguity that an `ambiguous` or
 * `out-of-scope` question asks the assistant to notice) is checked by review
 * when an entry is written, not here: each data module says what it was
 * reviewed against.
 */

const SEEDED = SAMPLE_FIXTURES.filter((fixture) => fixture.knowledge);
const seedOf = (fixture: SampleFixture) => fixture.knowledge as KnowledgeSeed;

/** `src/mastra/evals/sets/`, read only. */
const SETS_DIR = join(__dirname, '../../../../mastra/evals/sets');

interface BankCase {
  id: string;
  question: string;
  /** From the case notes' `Paraphrases: a | b` line: other wordings of it. */
  paraphrases: string[];
}

/**
 * The questions of a sample's bank files: `sets/<id>.json` (and any
 * `sets/<id>-<more>.json`), each of which must run on that sample.
 */
function bankCases(fixture: SampleFixture): BankCase[] {
  const files = readdirSync(SETS_DIR).filter(
    (file) =>
      file === `${fixture.id}.json` || file.startsWith(`${fixture.id}-`),
  );
  const cases: BankCase[] = [];
  for (const file of files) {
    const bank = JSON.parse(readFileSync(join(SETS_DIR, file), 'utf8')) as {
      variants?: { fixtureId?: string }[];
      cases?: { id?: string; question?: string; notes?: string }[];
    };
    expect(bank.variants?.some((v) => v.fixtureId === fixture.id)).toBe(true);
    for (const item of bank.cases ?? []) {
      if (!item.id || !item.question) continue;
      const paraphrases = /^Paraphrases:\s*(.+)$/m.exec(item.notes ?? '');
      cases.push({
        id: item.id,
        question: item.question,
        paraphrases: paraphrases
          ? paraphrases[1].split(' | ').map((p) => p.trim())
          : [],
      });
    }
  }
  return cases;
}

/** Base tables of a bundled seed and their columns (views are not parsed). */
function seedColumns(fixture: SampleFixture): Map<string, Set<string>> {
  const sql = readFileSync(
    join(__dirname, '..', fixture.seedFile as string),
    'utf8',
  );
  const tables = new Map<string, Set<string>>();
  for (const [, name, body] of sql.matchAll(
    /CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g,
  )) {
    const columns = new Set<string>();
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (/^(CHECK|UNIQUE|PRIMARY KEY|FOREIGN KEY|CONSTRAINT)\b/i.test(trimmed))
        continue;
      const column = /^(\w+)\s/.exec(trimmed);
      if (column) columns.add(column[1]);
    }
    tables.set(name, columns);
  }
  return tables;
}

/** Everything an entry or metric shows the assistant, in one string. */
function entryText(entry: SeedKnowledgeEntry): string {
  return [entry.title, entry.body, ...(entry.synonyms ?? [])].join('\n');
}
function metricText(metric: SeedMetric): string {
  return [metric.name, metric.label, metric.description ?? ''].join('\n');
}

/** Case-blind, whitespace-normalised, for verbatim comparisons. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A metrics service over an in-memory store, as the loader would call it. */
function metricsService(): MetricsService {
  const docs: MetricDoc[] = [];
  const repository = {
    findByName: (name: string) =>
      Promise.resolve(docs.find((doc) => doc.name === name) ?? null),
    insert: (doc: MetricDoc) => {
      docs.push(doc);
      return Promise.resolve(doc);
    },
  };
  return new MetricsService(repository as never, {} as never);
}

describe('sample knowledge seeds', () => {
  it('ship with the Finance, Health Insurance, Genomics and Supply Chain samples only', () => {
    expect(SEEDED.map((fixture) => fixture.id)).toEqual([
      'finance',
      'health-insurance',
      'genomics',
      'supply-chain',
    ]);
    for (const fixture of SEEDED) {
      expect(fixture.datasourceKind ?? 'postgres').toBe('postgres');
      expect(fixture.seedFile).toBeDefined();
    }
  });

  it('give every metric its own name, so all four samples can be loaded into one app', async () => {
    const service = metricsService();
    const names = SEEDED.flatMap((fixture) =>
      seedOf(fixture).metrics.map((metric) => metric.name),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const fixture of SEEDED) {
      for (const metric of seedOf(fixture).metrics) {
        await expect(
          service.create({
            ...metric,
            entity: `${fixture.defaults.database}.${metric.entity}`,
          }),
        ).resolves.toBeDefined();
      }
    }
  });

  describe.each(SEEDED.map((fixture) => [fixture.name, fixture] as const))(
    '%s',
    (_name, fixture) => {
      const seed = seedOf(fixture);
      const required = new Set(fixture.requiredTables);
      const entityOk = (entity: string) => {
        const [schema, table, ...rest] = entity.split('.');
        return (
          rest.length === 0 && schema === fixture.schema && required.has(table)
        );
      };

      it('has knowledge entries and metrics', () => {
        expect(seed.knowledge.length).toBeGreaterThan(0);
        expect(seed.metrics.length).toBeGreaterThan(0);
      });

      it.each(seed.knowledge.map((entry) => [entry.title, entry] as const))(
        'entry "%s" is one the knowledge service accepts, on the sample\'s own tables',
        (_title, entry) => {
          expect(KNOWLEDGE_SNIPPET_KINDS).toContain(entry.kind);
          expect(entry.title.trim()).toBe(entry.title);
          expect(entry.title).not.toBe('');
          expect(entry.body.trim()).toBe(entry.body);
          expect(entry.body).not.toBe('');
          for (const synonym of entry.synonyms ?? []) {
            expect(synonym.trim()).not.toBe('');
          }
          expect(entry.entities.length).toBeGreaterThan(0);
          expect(entry.entities.filter((entity) => !entityOk(entity))).toEqual(
            [],
          );
        },
      );

      it('never repeats a kind and title, the key that makes an entry held', () => {
        const keys = seed.knowledge.map(
          (entry) => `${entry.kind}:${entry.title.toLowerCase()}`,
        );
        expect(new Set(keys).size).toBe(keys.length);
      });

      it.each(seed.metrics.map((metric) => [metric.name, metric] as const))(
        'metric "%s" passes the metrics service validation on a table or view of the sample',
        async (_metricName, metric) => {
          expect(entityOk(metric.entity)).toBe(true);
          const saved = await metricsService().create({
            ...metric,
            entity: `${fixture.defaults.database}.${metric.entity}`,
            datasourceId: 'ds-1',
          });
          // Stored exactly as written: validation normalises nothing away.
          expect(saved).toEqual(
            expect.objectContaining({
              name: metric.name,
              label: metric.label,
              expression: metric.expression,
            }),
          );
        },
      );

      it('names only columns the bundled seed creates', () => {
        const tables = seedColumns(fixture);
        expect(tables.size).toBeGreaterThan(0);
        const texts = [
          ...seed.knowledge.map((entry) => entryText(entry)),
          ...seed.metrics.map((metric) => metricText(metric)),
        ];
        const unknown: string[] = [];
        for (const text of texts) {
          for (const [ref, table, column] of text.matchAll(
            /\b([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\b/g,
          )) {
            const columns = tables.get(table);
            if (columns && !columns.has(column)) unknown.push(ref);
          }
        }
        expect(unknown).toEqual([]);
      });

      describe('gives away no eval question (R27)', () => {
        const cases = bankCases(fixture);
        const texts = [
          ...seed.knowledge.map(
            (entry) => [entry.title, normalise(entryText(entry))] as const,
          ),
          ...seed.metrics.map(
            (metric) =>
              [`metric ${metric.name}`, normalise(metricText(metric))] as const,
          ),
        ];

        it('reads its question bank', () => {
          expect(cases.length).toBeGreaterThanOrEqual(10);
        });

        it('names no question id', () => {
          const offenders = texts.flatMap(([title, text]) =>
            cases
              .filter((item) => text.includes(item.id.toLowerCase()))
              .map((item) => `${title} names ${item.id}`),
          );
          expect(offenders).toEqual([]);
        });

        it("repeats no question's wording", () => {
          const offenders = texts.flatMap(([title, text]) =>
            cases.flatMap((item) =>
              [item.question, ...item.paraphrases]
                .map((wording) => normalise(wording).replace(/[?.!]+$/, ''))
                .filter((wording) => wording && text.includes(wording))
                .map((wording) => `${title} repeats "${wording}" (${item.id})`),
            ),
          );
          expect(offenders).toEqual([]);
        });

        it('is never phrased as the answer to a question', () => {
          const offenders = texts
            .filter(([, text]) =>
              /when asked|if asked|the answer is|answer to this/.test(text),
            )
            .map(([title]) => title);
          expect(offenders).toEqual([]);
        });
      });
    },
  );
});
