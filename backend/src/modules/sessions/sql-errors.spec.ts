import type {
  DatasetColumnSnapshot,
  DatasetSnapshot,
} from '../../mastra/tool-services';
import {
  describeSqlError,
  emptyResultHint,
  SQL_HINT_MARKER,
} from './sql-errors';

const DB = 'questions_to_insights.health_insurance';

function column(
  name: string,
  type: string,
  extra: Partial<DatasetColumnSnapshot> = {},
): DatasetColumnSnapshot {
  return { name, type, nullable: false, ...extra };
}

const CLAIMS = {
  key: `${DB}.claims`,
  columns: [
    column('id', 'bigint'),
    column('member_id', 'bigint'),
    column('provider_id', 'bigint'),
    column('status', 'text', {
      sampleValues: ['PAID', 'DENIED'],
      profile: {
        sampledRows: 1000,
        nullRate: 0,
        distinctCount: 4,
        constant: false,
        topValues: [
          { value: 'PAID', count: 700 },
          { value: 'DENIED', count: 150 },
          { value: 'PENDING', count: 100 },
          { value: 'REVERSED', count: 50 },
        ],
        profiledAt: '2026-09-23T00:00:00Z',
      },
    }),
    column('currency', 'text', { sampleValues: ['USD'] }),
    column('billed_amount_cents', 'bigint', { sampleValues: ['12500'] }),
    column('allowed_amount_cents', 'bigint'),
    column('paid_amount_cents', 'bigint', { sampleValues: ['9800'] }),
    column('service_date', 'date', { sampleValues: ['2024-03-14'] }),
    column('is_test', 'boolean'),
  ],
};
const PROVIDERS = {
  key: `${DB}.providers`,
  columns: [
    column('id', 'bigint'),
    column('name', 'text'),
    column('specialty', 'text', {
      sampleValues: ['Cardiology', 'Oncology', 'Radiology'],
    }),
  ],
};
const REGIONS = {
  key: `${DB}.regions`,
  columns: [
    column('id', 'bigint'),
    column('name', 'text', { sampleValues: ['New York', 'Newark'] }),
  ],
};

const SNAPSHOTS: DatasetSnapshot[] = [
  {
    name: 'Health Insurance',
    datasourceId: 'pg',
    datasourceKind: 'postgres',
    tables: [CLAIMS.key, PROVIDERS.key, REGIONS.key, `${DB}.claim_lines`],
    entities: [CLAIMS, PROVIDERS, REGIONS],
  },
];

const JOINED =
  'SELECT p.specialty, SUM(c.amount) FROM health_insurance.claims c JOIN health_insurance.providers p ON p.id = c.provider_id GROUP BY 1';

function hintOf(text: string): string {
  const at = text.indexOf(SQL_HINT_MARKER);
  return at < 0 ? '' : text.slice(at + SQL_HINT_MARKER.length);
}

describe('describeSqlError — unknown columns', () => {
  it('Postgres qualified column: closest columns on the aliased table', () => {
    const message = 'Postgres — column c.amount does not exist';
    const text = describeSqlError(new Error(message), JOINED, SNAPSHOTS);
    expect(text.startsWith(message)).toBe(true);
    expect(hintOf(text)).toBe(
      'Closest columns on health_insurance.claims: paid_amount_cents, billed_amount_cents, allowed_amount_cents.',
    );
  });

  it('Postgres bare column (with its own HINT): closest across the tables read', () => {
    const message =
      'Postgres — column "specialtyy" does not exist — HINT: Perhaps you meant to reference the column "p.specialty".';
    const text = describeSqlError(
      new Error(message),
      'SELECT specialtyy, COUNT(*) FROM health_insurance.claims c JOIN health_insurance.providers p ON p.id = c.provider_id GROUP BY 1',
      SNAPSHOTS,
    );
    expect(text.startsWith(message)).toBe(true);
    expect(hintOf(text)).toMatch(
      /^Closest columns on health_insurance\.providers: specialty/,
    );
  });

  it('points at a name the query itself defines', () => {
    const text = describeSqlError(
      new Error('column "total" does not exist'),
      'WITH t AS (SELECT c.member_id, SUM(c.paid_amount_cents) AS total_paid FROM health_insurance.claims c GROUP BY 1) SELECT total FROM t',
      SNAPSHOTS,
    );
    expect(hintOf(text)).toContain('defined in this query: total_paid');
  });

  it('Databricks UNRESOLVED_COLUMN', () => {
    const message =
      '[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `c`.`amount` cannot be resolved. Did you mean one of the following? [`c`.`id`, `c`.`status`]. SQLSTATE: 42703';
    const text = describeSqlError(new Error(message), JOINED, SNAPSHOTS);
    expect(hintOf(text)).toBe(
      'Closest columns on health_insurance.claims: paid_amount_cents, billed_amount_cents, allowed_amount_cents.',
    );
  });
});

describe('describeSqlError — unknown tables', () => {
  it('Postgres relation does not exist → tables in scope, closest first', () => {
    const text = describeSqlError(
      new Error('Postgres — relation "health_insurance.claim" does not exist'),
      'SELECT COUNT(*) FROM health_insurance.claim',
      SNAPSHOTS,
    );
    expect(hintOf(text)).toMatch(
      new RegExp(`^Tables in scope: ${DB.replace('.', '\\.')}\\.claims, `),
    );
    expect(hintOf(text)).toContain(`${DB}.claim_lines`);
  });

  it('Databricks TABLE_OR_VIEW_NOT_FOUND', () => {
    const text = describeSqlError(
      new Error(
        '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`hi`.`provider` cannot be found. Verify the spelling.',
      ),
      'SELECT * FROM main.hi.provider',
      SNAPSHOTS,
    );
    expect(hintOf(text)).toMatch(/^Tables in scope: .*\.providers/);
  });

  it('Postgres missing FROM-clause entry → the aliases the query defines', () => {
    const text = describeSqlError(
      new Error('missing FROM-clause entry for table "x"'),
      'SELECT x.status FROM health_insurance.claims c',
      SNAPSHOTS,
    );
    expect(hintOf(text)).toBe(
      '"x" is not defined in this query — its tables and aliases are: c.',
    );
  });
});

describe('describeSqlError — type errors', () => {
  it('Postgres operator does not exist: text = integer → the column type and a value', () => {
    const text = describeSqlError(
      new Error(
        'Postgres — operator does not exist: text = integer — HINT: No operator matches the given name and argument types.',
      ),
      'SELECT COUNT(*) FROM health_insurance.claims c WHERE c.status = 1',
      SNAPSHOTS,
    );
    expect(hintOf(text)).toBe("status is text, e.g. 'PAID'.");
  });

  it('Postgres invalid input syntax → the column the literal was compared with', () => {
    const text = describeSqlError(
      new Error('invalid input syntax for type bigint: "lots"'),
      "SELECT COUNT(*) FROM health_insurance.claims c WHERE c.paid_amount_cents > 'lots'",
      SNAPSHOTS,
    );
    expect(hintOf(text)).toBe('paid_amount_cents is bigint, e.g. 9800.');
  });

  it('Databricks DATATYPE_MISMATCH', () => {
    const text = describeSqlError(
      new Error(
        '[DATATYPE_MISMATCH.BINARY_OP_DIFF_TYPES] Cannot resolve "(service_date = 2024)" due to data type mismatch: the left and right operands of the binary operator have incompatible types ("DATE" and "INT").',
      ),
      'SELECT COUNT(*) FROM health_insurance.claims WHERE service_date = 2024',
      SNAPSHOTS,
    );
    expect(hintOf(text)).toBe('service_date is date, e.g. 2024-03-14.');
  });
});

describe('describeSqlError — pass-through', () => {
  it('returns an unrecognised error unchanged', () => {
    const message = 'Postgres — canceling statement due to statement timeout';
    expect(describeSqlError(new Error(message), JOINED, SNAPSHOTS)).toBe(
      message,
    );
    expect(describeSqlError('plain string', JOINED, SNAPSHOTS)).toBe(
      'plain string',
    );
  });

  it('never describes an error twice', () => {
    const once = describeSqlError(
      new Error('column c.amount does not exist'),
      JOINED,
      SNAPSHOTS,
    );
    expect(describeSqlError(new Error(once), JOINED, SNAPSHOTS)).toBe(once);
  });

  it('returns the message when there is no schema to draw on', () => {
    expect(
      describeSqlError(new Error('column c.amount does not exist'), JOINED, []),
    ).toBe('column c.amount does not exist');
  });
});

describe('emptyResultHint', () => {
  it('lists a profiled column’s whole vocabulary when the literal is not in it', () => {
    expect(
      emptyResultHint(
        "SELECT COUNT(*) FROM health_insurance.claims c WHERE c.status = 'APPROVED'",
        SNAPSHOTS,
      ),
    ).toBe('status holds: PAID, DENIED, PENDING, REVERSED (case-sensitive).');
  });

  it('says how a re-cased literal is stored', () => {
    expect(
      emptyResultHint(
        "SELECT COUNT(*) FROM health_insurance.claims c WHERE c.status IN ('paid', 'DENIED')",
        SNAPSHOTS,
      ),
    ).toBe(
      "status holds: PAID, DENIED, PENDING, REVERSED (case-sensitive) — 'paid' is stored as 'PAID'.",
    );
  });

  it('falls back to sample values as examples', () => {
    expect(
      emptyResultHint(
        "SELECT COUNT(*) FROM health_insurance.claims c JOIN health_insurance.providers p ON p.id = c.provider_id WHERE 'cardiology' = p.specialty",
        SNAPSHOTS,
      ),
    ).toBe(
      "specialty holds values such as: Cardiology, Oncology, Radiology (case-sensitive) — 'cardiology' is stored as 'Cardiology'.",
    );
  });

  it('reads a Databricks double-quoted string as a literal, not a column', () => {
    expect(
      emptyResultHint(
        'SELECT COUNT(*) FROM health_insurance.claims c WHERE c.status = "Paid"',
        SNAPSHOTS,
      ),
    ).toBe(
      "status holds: PAID, DENIED, PENDING, REVERSED (case-sensitive) — 'Paid' is stored as 'PAID'.",
    );
    // A double-quoted name that IS a column stays a column comparison.
    expect(
      emptyResultHint(
        'SELECT COUNT(*) FROM health_insurance.claims c WHERE c.status = "currency"',
        SNAPSHOTS,
      ),
    ).toBeUndefined();
  });

  it('adds nothing when the literal is a known value or the column is unknown', () => {
    expect(
      emptyResultHint(
        "SELECT 1 FROM health_insurance.claims c WHERE c.status = 'PAID' AND c.service_date > DATE '2030-01-01'",
        SNAPSHOTS,
      ),
    ).toBeUndefined();
    expect(
      emptyResultHint("SELECT 1 FROM elsewhere WHERE s = 'x'", SNAPSHOTS),
    ).toBeUndefined();
    expect(emptyResultHint('SELECT 1', [])).toBeUndefined();
  });
});
