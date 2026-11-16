import type { ResultView } from '../../modules/datasources/connectors/paged-sql.types';
import {
  explorerCandidateOf,
  explorerRequest,
  pageCountOf,
  RESULT_EXPLORER_AGENT_KEY,
  RESULT_EXPLORER_INSTRUCTIONS,
  RESULT_EXPLORER_REPLY_SCHEMA,
  specOf,
  understoodOf,
  type ExplorerCandidate,
} from './result-explorer.prompts';

const COLUMNS = ['Country', 'Goals', 'Year', 'Host'];
const ROWS: Record<string, unknown>[] = [
  { Country: 'Brazil', Goals: 4, Year: '2002-06-30', Host: false },
  { Country: 'Germany', Goals: 7, Year: '2014-07-13', Host: false },
  { Country: 'Spain', Goals: 1, Year: '2010-07-11', Host: false },
  { Country: 'France', Goals: 4, Year: '2018-07-15', Host: false },
  { Country: 'Italy', Goals: 2, Year: '2006-07-09', Host: false },
  { Country: 'Argentina', Goals: 3, Year: '2022-12-18', Host: true },
  { Country: null, Goals: 0, Year: '1998-07-12', Host: true },
];
const KINDS = {
  Country: 'text',
  Goals: 'number',
  Year: 'date',
  Host: 'boolean',
} as const;

const candidate = explorerCandidateOf(
  'Q1',
  COLUMNS,
  ROWS,
  { ...KINDS },
  'Final results by country',
);

const VIEW: ResultView = {
  filters: [{ column: 'Country', op: 'eq', value: 'Brazil' }],
  sort: [],
  page: 2,
  pageSize: 50,
  matchedRows: 412,
};

/** A full reply, with any field replaced. */
function reply(patch: Record<string, unknown> = {}) {
  return {
    action: 'explore',
    query: 1,
    filters: [],
    sort: [],
    page: { move: 'keep', to: null },
    understood: '',
    ...patch,
  };
}

describe('result-explorer catalogue (agents.md 2.17)', () => {
  it('is registered under its key, with the rules last', () => {
    expect(RESULT_EXPLORER_AGENT_KEY).toBe('result-explorer');
    expect(RESULT_EXPLORER_INSTRUCTIONS).toContain('new-question');
    expect(RESULT_EXPLORER_INSTRUCTIONS).toContain('COMPLETE');
    const last = RESULT_EXPLORER_INSTRUCTIONS.trim().split('\n').at(-1) ?? '';
    expect(last).toMatch(/new-question/);
  });

  it('parses a full reply with its schema', () => {
    const parsed = RESULT_EXPLORER_REPLY_SCHEMA.safeParse(
      reply({
        filters: [
          {
            column: 'Goals',
            op: 'between',
            value: 2,
            valueTo: 4,
            values: null,
          },
        ],
        sort: [{ column: 'Goals', direction: 'desc' }],
        page: { move: 'to', to: 3 },
        understood: 'Goals between 2 and 4',
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('explorerCandidateOf', () => {
  it('keeps at most 5 distinct non-null stored values per column', () => {
    expect(candidate.ref).toBe('Q1');
    expect(candidate.rationale).toBe('Final results by country');
    const country = candidate.columns.find((c) => c.name === 'Country');
    expect(country).toEqual({
      name: 'Country',
      kind: 'text',
      values: ['Brazil', 'Germany', 'Spain', 'France', 'Italy'],
    });
    const goals = candidate.columns.find((c) => c.name === 'Goals');
    expect(goals?.values).toEqual([4, 7, 1, 2, 3]);
    expect(candidate.columns.find((c) => c.name === 'Host')?.values).toEqual([
      false,
      true,
    ]);
  });

  it('truncates long strings to 60 characters and reads unknown kinds', () => {
    const long = 'x'.repeat(80);
    const c = explorerCandidateOf('Q2', ['note'], [{ note: long }], {});
    expect(c.columns[0].kind).toBe('unknown');
    expect(String(c.columns[0].values[0])).toHaveLength(60);
    expect(c.rationale).toBeUndefined();
  });
});

describe('explorerRequest', () => {
  it('holds the words, the view, the page count and the candidates; no SQL, no whole rows', () => {
    const text = explorerRequest('only goals over 3', [candidate], VIEW, 9);
    expect(text).toContain('only goals over 3');
    expect(text).toContain('Q1');
    expect(text).toContain('Final results by country');
    expect(text).toContain('page 2 of 9');
    expect(text).toContain('"Brazil"');
    expect(text).not.toMatch(/\bselect\b/i);
    expect(text).not.toContain('Argentina');
    for (const line of text.split('\n').filter((l) => /^- /.test(l))) {
      const values = line.split(':').slice(1).join(':');
      expect(values.split(', ').length).toBeLessThanOrEqual(5);
    }
  });

  it('says when there is no view yet and the page count is unknown', () => {
    const text = explorerRequest('next page', [candidate], null, null);
    expect(text).toMatch(/the answer's stored rows/i);
    expect(text).not.toContain('page 1 of');
  });
});

describe('specOf', () => {
  it('drops unknown columns into rejected, matching the rest case-insensitively', () => {
    const spec = specOf(
      reply({
        filters: [
          {
            column: 'country',
            op: 'eq',
            value: 'Brazil',
            valueTo: null,
            values: null,
          },
          {
            column: 'Continent',
            op: 'eq',
            value: 'Europe',
            valueTo: null,
            values: null,
          },
        ],
        sort: [{ column: 'Stadium', direction: 'asc' }],
      }),
      [candidate],
      null,
      null,
    );
    expect(spec.action).toBe('explore');
    expect(spec.query).toBe(0);
    expect(spec.interpretation.request.filters).toEqual([
      { column: 'Country', op: 'eq', value: 'Brazil' },
    ]);
    expect(spec.interpretation.request.sort).toEqual([]);
    expect(spec.interpretation.rejected).toEqual([
      'Continent is Europe',
      'sorted by Stadium',
    ]);
  });

  it('prefers an exact column over a case-insensitive one', () => {
    const c = explorerCandidateOf(
      'Q1',
      ['goals', 'Goals'],
      [{ goals: 1, Goals: 2 }],
      { goals: 'number', Goals: 'number' },
    );
    const spec = specOf(
      reply({ sort: [{ column: 'Goals', direction: 'desc' }] }),
      [c],
      null,
      null,
    );
    expect(spec.interpretation.request.sort).toEqual([
      { column: 'Goals', direction: 'desc' },
    ]);
  });

  it('coerces values by the column kind, and rejects what cannot be', () => {
    const spec = specOf(
      reply({
        filters: [
          {
            column: 'Goals',
            op: 'gte',
            value: '3',
            valueTo: null,
            values: null,
          },
          {
            column: 'Host',
            op: 'eq',
            value: 'true',
            valueTo: null,
            values: null,
          },
          {
            column: 'Goals',
            op: 'in',
            value: null,
            valueTo: null,
            values: ['1', 2],
          },
          {
            column: 'Year',
            op: 'between',
            value: '2000-01-01',
            valueTo: '2010-12-31',
            values: null,
          },
          {
            column: 'Country',
            op: 'starts_with',
            value: 'B',
            valueTo: null,
            values: null,
          },
          {
            column: 'Country',
            op: 'is_null',
            value: 'x',
            valueTo: null,
            values: null,
          },
          {
            column: 'Goals',
            op: 'gt',
            value: 'many',
            valueTo: null,
            values: null,
          },
          {
            column: 'Goals',
            op: 'lt',
            value: null,
            valueTo: null,
            values: null,
          },
        ],
      }),
      [candidate],
      null,
      null,
    );
    expect(spec.interpretation.request.filters).toEqual([
      { column: 'Goals', op: 'gte', value: 3 },
      { column: 'Host', op: 'eq', value: true },
      { column: 'Goals', op: 'in', values: [1, 2] },
      {
        column: 'Year',
        op: 'between',
        value: '2000-01-01',
        valueTo: '2010-12-31',
      },
      { column: 'Country', op: 'starts_with', value: 'B' },
      { column: 'Country', op: 'is_null' },
    ]);
    expect(spec.interpretation.rejected).toEqual([
      'Goals greater than many',
      'Goals less than',
    ]);
  });

  it('keeps at most 10 filters and 3 sort keys', () => {
    const filters = Array.from({ length: 12 }, (_, i) => ({
      column: 'Goals',
      op: 'neq',
      value: i,
      valueTo: null,
      values: null,
    }));
    const sort = ['Country', 'Goals', 'Year', 'Host'].map((column) => ({
      column,
      direction: 'asc',
    }));
    const spec = specOf(reply({ filters, sort }), [candidate], null, null);
    expect(spec.interpretation.request.filters).toHaveLength(10);
    expect(spec.interpretation.request.sort).toHaveLength(3);
  });

  it('resolves the page move to an absolute page', () => {
    const move = (
      m: string,
      to: number | null = null,
      pageCount: number | null = 9,
    ) =>
      specOf(reply({ page: { move: m, to } }), [candidate], VIEW, pageCount)
        .interpretation.request.page;
    expect(move('next')).toBe(3);
    expect(move('previous')).toBe(1);
    expect(move('first')).toBe(1);
    expect(move('last')).toBe(9);
    expect(move('keep')).toBe(2);
    expect(move('to', 5)).toBe(5);
    expect(move('to', 40)).toBe(9);
    expect(move('to', 0)).toBe(1);
    expect(move('to', 40, null)).toBe(40);
    expect(move('last', null, null)).toBe(2);
    expect(move('next', null, 2)).toBe(2);
  });

  it("moves from the picked candidate's own view when it has one", () => {
    const own: ExplorerCandidate = {
      ...candidate,
      ref: 'Q2',
      view: { filters: [], sort: [], page: 5, pageSize: 20, matchedRows: 200 },
    };
    const spec = specOf(
      reply({ query: 2, page: { move: 'next', to: null } }),
      [{ ...candidate, view: VIEW }, own],
      VIEW,
      9,
    );
    expect(spec.query).toBe(1);
    expect(spec.interpretation.request.page).toBe(6);
    expect(spec.interpretation.request.pageSize).toBe(20);
    const last = specOf(
      reply({ query: 2, page: { move: 'last', to: null } }),
      [candidate, own],
      VIEW,
      9,
    );
    expect(last.interpretation.request.page).toBe(10);
  });

  it("lists each candidate's own view in the request", () => {
    const text = explorerRequest(
      'next page',
      [
        { ...candidate, view: VIEW },
        { ...candidate, ref: 'Q2', view: null },
      ],
      VIEW,
      9,
    );
    expect(text).toContain('  Current view: page 2 of 9, 50 rows a page');
    expect(text).toContain(
      "  Current view: none yet; the user sees the answer's stored rows.",
    );
  });

  it('keeps the page size of the current view', () => {
    const spec = specOf(reply(), [candidate], { ...VIEW, pageSize: 20 }, 21);
    expect(spec.interpretation.request.pageSize).toBe(20);
    expect(
      specOf(reply(), [candidate], null, null).interpretation.request.page,
    ).toBe(1);
  });

  it('picks the candidate the reply names, 1-based, else the first', () => {
    const other: ExplorerCandidate = explorerCandidateOf(
      'Q2',
      ['team'],
      [{ team: 'Brazil' }],
      { team: 'text' },
    );
    const second = specOf(
      reply({
        query: 2,
        filters: [
          {
            column: 'Team',
            op: 'eq',
            value: 'Brazil',
            valueTo: null,
            values: null,
          },
        ],
      }),
      [candidate, other],
      null,
      null,
    );
    expect(second.query).toBe(1);
    expect(second.interpretation.request.filters).toEqual([
      { column: 'team', op: 'eq', value: 'Brazil' },
    ]);
    expect(
      specOf(reply({ query: 7 }), [candidate, other], null, null).query,
    ).toBe(0);
    expect(
      specOf(reply({ query: null }), [candidate, other], null, null).query,
    ).toBe(0);
  });

  it('reads new-question, and takes understood from the reply', () => {
    const spec = specOf(
      reply({ action: 'new-question', understood: 'Average goals per year' }),
      [candidate],
      VIEW,
      9,
    );
    expect(spec.action).toBe('new-question');
    expect(spec.interpretation.understood).toBe('Average goals per year');
  });

  it('builds understood from the spec when the reply has none', () => {
    const spec = specOf(
      reply({
        filters: [
          {
            column: 'Country',
            op: 'eq',
            value: 'Brazil',
            valueTo: null,
            values: null,
          },
          { column: 'Goals', op: 'gte', value: 3, valueTo: null, values: null },
        ],
        sort: [{ column: 'Goals', direction: 'desc' }],
      }),
      [candidate],
      null,
      null,
    );
    expect(spec.interpretation.understood).toBe(
      'Country is Brazil · Goals at least 3 · sorted by Goals, high to low',
    );
    expect(
      understoodOf({
        filters: [
          { column: 'Year', op: 'between', value: 2000, valueTo: 2010 },
          { column: 'Country', op: 'not_in', values: ['Spain', 'Italy'] },
          { column: 'Country', op: 'not_null' },
        ],
        page: 3,
      }),
    ).toBe(
      'Year between 2000 and 2010 · Country is not one of Spain, Italy · Country is not empty · page 3',
    );
    expect(understoodOf({})).toBe('All rows');
  });

  it('reads a JSON text reply, and throws on a reply that is no object', () => {
    const spec = specOf(
      '```json\n' +
        JSON.stringify(reply({ page: { move: 'next', to: null } })) +
        '\n```',
      [candidate],
      VIEW,
      9,
    );
    expect(spec.interpretation.request.page).toBe(3);
    expect(() => specOf('no idea', [candidate], VIEW, 9)).toThrow(
      'the reply was not a JSON object',
    );
  });
});

describe('pageCountOf', () => {
  it('reads the page count of a view with matched rows', () => {
    expect(pageCountOf(VIEW)).toBe(9);
    expect(pageCountOf({ ...VIEW, matchedRows: 0 })).toBe(1);
    expect(pageCountOf({ ...VIEW, matchedRows: undefined })).toBeNull();
    expect(pageCountOf(null)).toBeNull();
  });
});
