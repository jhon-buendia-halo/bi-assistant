import { pinEligible } from './eligibility';
import { STORED_ROWS_CAP } from '../sessions/turn-data';
import type { ToolDataRecord } from '../sessions/entities/session.entity';

const RECORD: ToolDataRecord = {
  tool: 'run_readonly_sql',
  input: 'SELECT 1',
  columns: ['n'],
  rows: [{ n: 1 }],
  rowCount: 1,
};

function input(overrides: Partial<Parameters<typeof pinEligible>[0]> = {}) {
  return {
    record: RECORD,
    text: 'The answer is 1.',
    datasourceId: 'ds-1',
    ...overrides,
  };
}

describe('pinEligible', () => {
  it('is eligible for a clean single-row answer with a datasource', () => {
    expect(pinEligible(input())).toBe(true);
  });

  it('is eligible up to the stored-rows cap', () => {
    expect(
      pinEligible(input({ record: { ...RECORD, rowCount: STORED_ROWS_CAP } })),
    ).toBe(true);
  });

  it('rejects a missing record', () => {
    expect(pinEligible(input({ record: undefined }))).toBe(false);
  });

  it('rejects a record with an error', () => {
    expect(
      pinEligible(input({ record: { ...RECORD, error: 'boom' } })),
    ).toBe(false);
  });

  it('rejects a truncated record', () => {
    expect(
      pinEligible(input({ record: { ...RECORD, truncated: true } })),
    ).toBe(false);
  });

  it('rejects zero rows', () => {
    expect(
      pinEligible(input({ record: { ...RECORD, rowCount: 0, rows: [] } })),
    ).toBe(false);
  });

  it('rejects more rows than the stored-rows cap', () => {
    expect(
      pinEligible(
        input({ record: { ...RECORD, rowCount: STORED_ROWS_CAP + 1 } }),
      ),
    ).toBe(false);
  });

  it('rejects result-guard warnings', () => {
    expect(
      pinEligible(
        input({ record: { ...RECORD, warnings: ['unordered top N'] } }),
      ),
    ).toBe(false);
  });

  it('rejects a clarification turn', () => {
    expect(
      pinEligible(input({ clarification: { question: 'Which region?' } })),
    ).toBe(false);
  });

  it('rejects a turn that produced a visual event', () => {
    expect(
      pinEligible(
        input({
          visualEvent: { visualId: 'v1', version: 1, title: 'x', action: 'created' },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a turn with an active visual panel open', () => {
    expect(pinEligible(input({ activeVisualId: 'v1' }))).toBe(false);
  });

  it('rejects empty answer text', () => {
    expect(pinEligible(input({ text: '   ' }))).toBe(false);
  });

  it('rejects a missing datasource id', () => {
    expect(pinEligible(input({ datasourceId: undefined }))).toBe(false);
  });
});
