import * as fs from 'fs';
import * as path from 'path';
import {
  FIXTURE_SEMANTICS,
  type FixtureSemantics,
  type SemanticKnowledgeSnippet,
  type SemanticKnowledgeKind,
  type SemanticMetric,
} from '../../../scripts/fixture-semantics';

// jest `rootDir` is `src` (backend/package.json), so this spec lives under
// `src/mastra/evals/` per the unit's file-ownership list, and reaches into
// `scripts/` with a relative import instead of a path alias.

const REPO_ROOT = path.join(__dirname, '../../../..');
const DDL_FILES: Record<string, string> = {
  world_cup: path.join(REPO_ROOT, 'docker/postgres/init/001_world_cup.sql'),
  health_insurance: path.join(
    REPO_ROOT,
    'docker/postgres/init/002_health_insurance.sql',
  ),
  genomics: path.join(REPO_ROOT, 'docker/postgres/init/003_genomics.sql'),
  supply_chain: path.join(
    REPO_ROOT,
    'docker/postgres/init/006_supply_chain.sql',
  ),
  banking: path.join(REPO_ROOT, 'docker/postgres/init/007_banking.sql'),
};

const VALID_KINDS: SemanticKnowledgeKind[] = [
  'term',
  'instruction',
  'default_filter',
];

/** table/view name → its column names (empty set for a view — see parseDdl). */
type SchemaColumns = Record<string, Set<string>>;

const SKIP_PREFIXES = /^(CHECK|UNIQUE|PRIMARY KEY|FOREIGN KEY|CONSTRAINT)\b/i;

/**
 * Minimal regex-based DDL reader — good enough for these three generated/
 * hand-written fixture files, which are consistently formatted (one
 * constraint or column per line, `CREATE TABLE name (` ... `);` with the
 * closing `);` alone on its own line). Not a general SQL parser.
 */
function parseDdl(sql: string): SchemaColumns {
  const tables: SchemaColumns = {};
  const tableRe = /CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(sql))) {
    const [, name, body] = match;
    const columns = new Set<string>();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || SKIP_PREFIXES.test(line)) continue;
      const columnMatch = line.match(/^(\w+)\s/);
      if (columnMatch) columns.add(columnMatch[1]);
    }
    tables[name] = columns;
  }
  const viewRe = /CREATE VIEW (\w+) AS/g;
  while ((match = viewRe.exec(sql))) {
    const [, name] = match;
    if (!tables[name]) tables[name] = new Set<string>();
  }
  return tables;
}

const DDL_CACHE = new Map<string, SchemaColumns>();
function schemaColumns(schema: string): SchemaColumns {
  const cached = DDL_CACHE.get(schema);
  if (cached) return cached;
  const file = DDL_FILES[schema];
  if (!file) throw new Error(`No DDL file mapped for schema "${schema}"`);
  const sql = fs.readFileSync(file, 'utf8');
  const parsed = parseDdl(sql);
  DDL_CACHE.set(schema, parsed);
  return parsed;
}

/** Split a `schema.table` entity string, failing loudly on the wrong shape. */
function splitEntity(entity: string): [schema: string, table: string] {
  const parts = entity.split('.');
  if (parts.length !== 2) {
    throw new Error(
      `Entity "${entity}" must be "schema.table" (two segments) — the dataset ` +
        "key's last two segments, per the module doc in fixture-semantics.ts",
    );
  }
  return [parts[0], parts[1]];
}

// ------------------------------------------------------------ suite corpus

interface SuiteCase {
  id: string;
  question: string;
}

function loadSuiteCases(): SuiteCase[] {
  const suitesDir = path.join(__dirname, 'suites');
  const files = [
    'world-cup.json',
    'health-insurance.json',
    'genomics.json',
    'supply-chain.json',
    'banking.json',
  ];
  const cases: SuiteCase[] = [];
  for (const file of files) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(suitesDir, file), 'utf8'),
    ) as { cases?: SuiteCase[] };
    for (const c of raw.cases ?? []) {
      if (c?.id && c?.question) cases.push({ id: c.id, question: c.question });
    }
  }
  return cases;
}

describe('fixture-semantics', () => {
  const suiteCases = loadSuiteCases();

  it('loads a real corpus of suite cases to check against (sanity)', () => {
    expect(suiteCases.length).toBeGreaterThanOrEqual(40); // 10 + 20 + 20
  });

  it('has exactly the five fixtures, each with a matching schema DDL file', () => {
    const schemas = FIXTURE_SEMANTICS.map((f) => f.schema).sort();
    expect(schemas).toEqual([
      'banking',
      'genomics',
      'health_insurance',
      'supply_chain',
      'world_cup',
    ]);
  });

  for (const fixture of FIXTURE_SEMANTICS) {
    describe(`${fixture.datasetName} (${fixture.schema})`, () => {
      const columns = schemaColumns(fixture.schema);

      it('has a non-trivial one-paragraph description', () => {
        expect(fixture.description.length).toBeGreaterThan(200);
        expect(fixture.description.trim().endsWith('.')).toBe(true);
      });

      it(
        fixture.schema === 'world_cup'
          ? 'has at least 5 knowledge snippets'
          : 'has at least 8 knowledge snippets',
        () => {
          const min = fixture.schema === 'world_cup' ? 5 : 8;
          expect(fixture.knowledge.length).toBeGreaterThanOrEqual(min);
        },
      );

      it.each(
        fixture.knowledge.map((s): [string, SemanticKnowledgeSnippet] => [
          s.title,
          s,
        ]),
      )('snippet "%s" is well-formed', (_title, snippet) => {
        expect(VALID_KINDS).toContain(snippet.kind);
        expect(snippet.title.trim().length).toBeGreaterThan(0);
        expect(snippet.body.trim().length).toBeGreaterThan(0);
        expect(snippet.entities.length).toBeGreaterThan(0);

        for (const entity of snippet.entities) {
          const [schema, table] = splitEntity(entity);
          expect(schema).toBe(fixture.schema);
          expect(columns).toHaveProperty(table);
        }

        if (snippet.column !== undefined) {
          // Mirrors `KnowledgeService`'s `requireSingleEntity` rule
          // (knowledge.service.ts) — a snippet's `column` is only valid
          // when it names exactly one entity.
          expect(snippet.entities.length).toBe(1);
          const [, table] = splitEntity(snippet.entities[0]);
          expect(columns[table].has(snippet.column)).toBe(true);
        }
      });

      it('has unique snippet titles (idempotency key for bootstrap-fixtures.ts)', () => {
        const titles = fixture.knowledge.map((s) => s.title);
        expect(new Set(titles).size).toBe(titles.length);
      });

      if (fixture.metrics.length) {
        it.each(
          fixture.metrics.map((m): [string, SemanticMetric] => [m.name, m]),
        )('metric "%s" is well-formed', (_name, metric) => {
          expect(metric.name).toMatch(/^[a-z][a-z0-9_]*$/);
          expect(metric.label.trim().length).toBeGreaterThan(0);
          expect(metric.expression.trim().length).toBeGreaterThan(0);
          expect(metric.expression).not.toContain(';');
          const [schema, table] = splitEntity(metric.entity);
          expect(schema).toBe(fixture.schema);
          expect(columns).toHaveProperty(table);
        });
      } else {
        it('has no metrics (none defined for this fixture)', () => {
          expect(fixture.metrics).toEqual([]);
        });
      }

      it('has unique metric names', () => {
        const names = fixture.metrics.map((m) => m.name);
        expect(new Set(names).size).toBe(names.length);
      });
    });
  }

  // ---------------------------------------------------- overfitting guard

  describe('overfitting guard', () => {
    const allSnippets = FIXTURE_SEMANTICS.flatMap((f) => f.knowledge);
    const allText = (s: SemanticKnowledgeSnippet) =>
      `${s.title}\n${s.body}\n${(s.synonyms ?? []).join(' ')}`.toLowerCase();

    it('no snippet mentions an eval case id', () => {
      const offenders: string[] = [];
      for (const snippet of allSnippets) {
        const text = allText(snippet);
        for (const c of suiteCases) {
          // Case ids are kebab-case and specific enough (e.g.
          // "net-paid-after-reversals-2024") that a substring hit is a real
          // signal, not a coincidence — long enough ids only, to avoid a
          // short id like a two-word accident matching by chance.
          if (c.id.length >= 8 && text.includes(c.id.toLowerCase())) {
            offenders.push(`${snippet.title} mentions case id "${c.id}"`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('no snippet copies a case question verbatim', () => {
      const offenders: string[] = [];
      for (const snippet of allSnippets) {
        const body = snippet.body.trim().toLowerCase();
        for (const c of suiteCases) {
          const question = c.question.trim().toLowerCase();
          if (body === question) {
            offenders.push(
              `${snippet.title} copies case "${c.id}"'s question verbatim`,
            );
            continue;
          }
          // Also catch the question embedded as a substring inside a longer
          // body (a paraphrase-by-inclusion), for anything but the shortest
          // questions (avoid false positives on short, generic phrasing).
          if (question.length >= 25 && body.includes(question)) {
            offenders.push(
              `${snippet.title} embeds case "${c.id}"'s question verbatim`,
            );
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('no snippet body states "when asked X, answer Y" phrasing', () => {
      const offenders = allSnippets
        .filter((s) =>
          /when asked|if asked|the answer is|answer to this/i.test(s.body),
        )
        .map((s) => s.title);
      expect(offenders).toEqual([]);
    });
  });

  // --------------------------------------------------------- cross-fixture

  it('keeps net_paid and allele_fraction expressions unchanged from the pre-U2-D script', () => {
    const health = FIXTURE_SEMANTICS.find(
      (f) => f.schema === 'health_insurance',
    );
    const genomics = FIXTURE_SEMANTICS.find((f) => f.schema === 'genomics');
    const netPaid = health?.metrics.find((m) => m.name === 'net_paid');
    const alleleFraction = genomics?.metrics.find(
      (m) => m.name === 'allele_fraction',
    );
    expect(netPaid?.expression).toBe(
      "SUM(paid_amount_cents) FILTER (WHERE status='PAID') - SUM(paid_amount_cents) FILTER (WHERE status='REVERSED')",
    );
    expect(alleleFraction?.expression).toBe(
      "AVG(alt_read_count::numeric / NULLIF(total_read_count, 0)) FILTER (WHERE filter_status = 'PASS' AND total_read_count >= 20)",
    );
  });

  it("seeds a denial_rate metric matching the denial-rate case's reference definition", () => {
    const health = FIXTURE_SEMANTICS.find(
      (f) => f.schema === 'health_insurance',
    );
    const denialRate = health?.metrics.find((m) => m.name === 'denial_rate');
    expect(denialRate).toBeDefined();
    expect(denialRate?.expression).toContain(
      "FILTER (WHERE status = 'DENIED')",
    );
    expect(denialRate?.expression).toContain(
      "FILTER (WHERE status <> 'PENDING')",
    );
  });
});
