import { findingRowsQuery } from './finding-rows-sql';
import { completenessCheck } from './engine/checks/completeness.check';
import { consistencyCheck } from './engine/checks/consistency.check';
import { integrityCheck } from './engine/checks/integrity.check';
import { reasonabilityCheck } from './engine/checks/reasonability.check';
import { timelinessCheck } from './engine/checks/timeliness.check';
import { uniquenessCheck } from './engine/checks/uniqueness.check';
import { validityCheck } from './engine/checks/validity.check';
import { accessibilityCheck } from './engine/checks/accessibility.check';
import {
  DEFAULT_THRESHOLDS,
  type CheckContext,
  type EntityProfile,
  type FieldProfile,
  type Finding,
} from './engine/types';

// The findings come from the real checks, so a change to a check's wording
// or fields that the builder reads breaks here (roadmap 1.27.11).
const CTX: CheckContext = {
  thresholds: DEFAULT_THRESHOLDS,
  now: new Date('2026-11-16T00:00:00Z'),
};

function field(p: Partial<FieldProfile> & { name: string }): FieldProfile {
  return { type: 'text', semanticType: 'text', nullable: true, ...p };
}

function entity(
  fields: FieldProfile[],
  p: Partial<EntityProfile> = {},
): EntityProfile {
  return {
    namespace: 'formula1',
    name: 'results',
    rowCount: 100,
    fields,
    keys: [],
    ...p,
  };
}

const PG_TABLE = '"formula1"."results"';
const DBX_TABLE = '`main`.`formula1`.`results`';
const DBX = { namespace: 'main.formula1' };

function only(findings: Finding[]): Finding {
  expect(findings).toHaveLength(1);
  return findings[0];
}

describe('findingRowsQuery (roadmap 1.27.11)', () => {
  describe('completeness: the rows where the column is empty', () => {
    const finding = only(
      completenessCheck(
        entity([field({ name: 'constructor', nullCount: 12 })]),
        CTX,
      ).findings,
    );

    it('on PostgreSQL, with every row and the count that matches', () => {
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT *, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM ${PG_TABLE} WHERE "constructor" IS NULL`,
        rationale: 'Rows where constructor is empty in formula1.results',
      });
    });

    it('on Databricks, with backticks and the catalog', () => {
      const dbx = only(
        completenessCheck(
          entity([field({ name: 'constructor', nullCount: 12 })], DBX),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(dbx, 'databricks')?.sql).toBe(
        `SELECT *, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM ${DBX_TABLE} WHERE \`constructor\` IS NULL`,
      );
    });

    it('escapes quotes inside identifiers', () => {
      const odd = only(
        completenessCheck(
          entity([field({ name: 'a"b', nullCount: 1 })], { name: 'x"y' }),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(odd, 'postgres')?.sql).toContain(
        'FROM "formula1"."x""y" WHERE "a""b" IS NULL',
      );
      const tick = only(
        completenessCheck(
          entity([field({ name: 'a`b', nullCount: 1 })], DBX),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(tick, 'databricks')?.sql).toContain(
        'WHERE `a``b` IS NULL',
      );
    });
  });

  describe('uniqueness: the values that repeat', () => {
    it('groups a declared key by all its columns, most repeated first', () => {
      const finding = only(
        uniquenessCheck(
          entity([], {
            keys: [
              {
                kind: 'primary',
                fields: ['race_id', 'driver_id'],
                duplicateCount: 3,
              },
            ],
          }),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT "race_id", "driver_id", COUNT(*) AS occurrences FROM ${PG_TABLE} GROUP BY "race_id", "driver_id" HAVING COUNT(*) > 1 ORDER BY occurrences DESC, "race_id", "driver_id"`,
        rationale:
          'Values of race_id, driver_id that repeat in formula1.results',
      });
    });

    it('leaves out the empty values of an id-like column, as the check does', () => {
      const finding = only(
        uniquenessCheck(
          entity([
            field({
              name: 'driver_id',
              distinctCount: 90,
              nullCount: 2,
            }),
          ]),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'databricks')?.sql).toBe(
        'SELECT `driver_id`, COUNT(*) AS occurrences FROM `formula1`.`results` WHERE `driver_id` IS NOT NULL GROUP BY `driver_id` HAVING COUNT(*) > 1 ORDER BY occurrences DESC, `driver_id`',
      );
    });
  });

  describe('integrity: the child rows with no parent', () => {
    const relationship = {
      fromNamespace: 'formula1',
      fromEntity: 'results',
      fromField: 'constructor_id',
      toNamespace: 'formula1',
      toEntity: 'constructors',
      toField: 'id',
      orphanCount: 4,
    };

    it('joins the relationship the check measured', () => {
      const finding = only(
        integrityCheck(
          {
            sourceId: 's',
            sourceType: 'postgres',
            entities: [],
            relationships: [relationship],
          },
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT c.*, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM ${PG_TABLE} c LEFT JOIN "formula1"."constructors" p ON c."constructor_id" = p."id" WHERE c."constructor_id" IS NOT NULL AND p."id" IS NULL`,
        rationale:
          'Rows of formula1.results whose constructor_id has no match in formula1.constructors',
      });
    });

    it('reads a Databricks catalog.schema namespace, inferred or not', () => {
      const finding = only(
        integrityCheck(
          {
            sourceId: 's',
            sourceType: 'databricks',
            entities: [],
            relationships: [
              {
                ...relationship,
                fromNamespace: 'main.formula1',
                toNamespace: 'main.formula1',
                origin: 'inferred',
              },
            ],
          },
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'databricks')?.sql).toBe(
        `SELECT c.*, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM ${DBX_TABLE} c LEFT JOIN \`main\`.\`formula1\`.\`constructors\` p ON c.\`constructor_id\` = p.\`id\` WHERE c.\`constructor_id\` IS NOT NULL AND p.\`id\` IS NULL`,
      );
    });

    it('builds nothing when the description no longer names the parent', () => {
      const finding = only(
        integrityCheck(
          {
            sourceId: 's',
            sourceType: 'postgres',
            entities: [],
            relationships: [relationship],
          },
          CTX,
        ).findings,
      );
      expect(
        findingRowsQuery(
          { ...finding, description: 'Orphans found.' },
          'postgres',
        ),
      ).toBeUndefined();
    });
  });

  describe('reasonability: the rows at the implausible end', () => {
    it('keeps the negative values, lowest first, with their count', () => {
      const finding = only(
        reasonabilityCheck(
          entity([
            field({
              name: 'points',
              type: 'numeric',
              semanticType: 'numeric',
              min: '-5',
              max: '25',
            }),
          ]),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT *, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM ${PG_TABLE} WHERE "points" < 0 ORDER BY "points" ASC`,
        rationale: 'Rows where points is negative in formula1.results',
      });
    });

    it('orders future dates latest first and old ones earliest first, without empty values', () => {
      const findings = reasonabilityCheck(
        entity([
          field({
            name: 'race_date',
            type: 'date',
            semanticType: 'temporal',
            min: '1850-01-01',
            max: '2099-01-01',
          }),
        ]),
        CTX,
      ).findings;
      expect(findings).toHaveLength(2);
      const [future, old] = findings;
      expect(findingRowsQuery(future, 'postgres')).toEqual({
        sql: `SELECT * FROM ${PG_TABLE} WHERE "race_date" IS NOT NULL ORDER BY "race_date" DESC`,
        rationale: 'Rows of formula1.results with the latest race_date',
      });
      expect(findingRowsQuery(old, 'postgres')).toEqual({
        sql: `SELECT * FROM ${PG_TABLE} WHERE "race_date" IS NOT NULL ORDER BY "race_date" ASC`,
        rationale: 'Rows of formula1.results with the earliest race_date',
      });
    });

    it('orders a ratio over its bound highest first', () => {
      const finding = only(
        reasonabilityCheck(
          entity([
            field({
              name: 'win_pct',
              type: 'numeric',
              semanticType: 'numeric',
              min: '0',
              max: '140',
            }),
          ]),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'databricks')?.sql).toBe(
        'SELECT * FROM `formula1`.`results` WHERE `win_pct` IS NOT NULL ORDER BY `win_pct` DESC',
      );
    });

    it('keeps the rows whose end comes before their start', () => {
      const finding = only(
        reasonabilityCheck(
          entity([
            field({
              name: 'start_date',
              type: 'date',
              semanticType: 'temporal',
              min: '2020-01-01',
              max: '2021-01-01',
            }),
            field({
              name: 'end_date',
              type: 'date',
              semanticType: 'temporal',
              min: '2019-01-01',
              max: '2019-06-01',
            }),
          ]),
          CTX,
        ).findings.filter((f) => f.field?.includes(',')),
      );
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT *, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM ${PG_TABLE} WHERE "end_date" < "start_date"`,
        rationale:
          'Rows of formula1.results where end_date comes before start_date',
      });
    });
  });

  describe('timeliness: the newest rows', () => {
    it('orders by the column the check read, newest first', () => {
      const finding = only(
        timelinessCheck(
          entity([
            field({
              name: 'updated_at',
              type: 'timestamp',
              semanticType: 'temporal',
              max: '2020-01-01T00:00:00Z',
            }),
          ]),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT * FROM ${PG_TABLE} WHERE "updated_at" IS NOT NULL ORDER BY "updated_at" DESC`,
        rationale: 'The newest rows of formula1.results by updated_at',
      });
    });

    it('builds nothing when the check read the table’s last change', () => {
      const finding = only(
        timelinessCheck(
          entity([], { lastModifiedAt: '2020-01-01T00:00:00Z' }),
          CTX,
        ).findings,
      );
      expect(findingRowsQuery(finding, 'databricks')).toBeUndefined();
    });
  });

  describe('consistency: the values that differ only by case or spaces', () => {
    const finding = only(
      consistencyCheck(
        entity([
          field({
            name: 'nationality',
            distinctCount: 40,
            normalizedDistinctCount: 38,
          }),
        ]),
        CTX,
      ).findings,
    );

    it('on PostgreSQL, grouped so the variants sit together', () => {
      const norm = 'LOWER(TRIM(CAST("nationality" AS TEXT)))';
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT "nationality", COUNT(*) AS occurrences FROM ${PG_TABLE} WHERE ${norm} IN (SELECT ${norm} FROM ${PG_TABLE} GROUP BY ${norm} HAVING COUNT(DISTINCT "nationality") > 1) GROUP BY "nationality" ORDER BY ${norm}, "nationality"`,
        rationale:
          'Values of nationality in formula1.results that differ only by case or spaces',
      });
    });

    it('on Databricks, cast to STRING', () => {
      expect(findingRowsQuery(finding, 'databricks')?.sql).toContain(
        'LOWER(TRIM(CAST(`nationality` AS STRING)))',
      );
    });
  });

  describe('validity: the values that fail their format', () => {
    const finding = only(
      validityCheck(
        entity([
          field({ name: 'email', formatRule: 'email', invalidFormatCount: 3 }),
        ]),
        CTX,
      ).findings,
    );

    it('on PostgreSQL, with the profiler’s own pattern', () => {
      expect(findingRowsQuery(finding, 'postgres')).toEqual({
        sql: `SELECT *, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM ${PG_TABLE} WHERE "email" IS NOT NULL AND CAST("email" AS TEXT) !~* '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
        rationale: 'Rows where email is not a valid email in formula1.results',
      });
    });

    it('on Databricks, with regexp_like as the profiler matches', () => {
      expect(findingRowsQuery(finding, 'databricks')?.sql).toBe(
        "SELECT *, CAST(COUNT(*) OVER () AS INTEGER) AS matching_rows FROM `formula1`.`results` WHERE `email` IS NOT NULL AND NOT regexp_like(CAST(`email` AS STRING), r'(?i)^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')",
      );
    });
  });

  it('builds nothing for accessibility or a finding with no table or column', () => {
    const accessibility = accessibilityCheck(
      {
        sourceId: 's',
        sourceType: 'postgres',
        entities: [entity([], { readable: false })],
        relationships: [],
      },
      CTX,
    ).findings;
    expect(accessibility.length).toBeGreaterThan(0);
    for (const finding of accessibility) {
      expect(findingRowsQuery(finding, 'postgres')).toBeUndefined();
    }
    const sourceLevel: Finding = {
      dimension: 'completeness',
      level: 'source',
      severity: 'low',
      description: 'x',
      recommendation: 'y',
    };
    expect(findingRowsQuery(sourceLevel, 'postgres')).toBeUndefined();
  });

  it('never writes a CTE or a LIMIT: the run caps the rows and the inspector pages them', () => {
    const findings = [
      ...completenessCheck(entity([field({ name: 'a', nullCount: 1 })]), CTX)
        .findings,
      ...consistencyCheck(
        entity([
          field({ name: 'b', distinctCount: 3, normalizedDistinctCount: 2 }),
        ]),
        CTX,
      ).findings,
    ];
    for (const finding of findings) {
      for (const dialect of ['postgres', 'databricks'] as const) {
        const sql = findingRowsQuery(finding, dialect)!.sql;
        expect(sql).toMatch(/^SELECT /);
        expect(sql).not.toMatch(/\bWITH\b|\bLIMIT\b/i);
      }
    }
  });
});
