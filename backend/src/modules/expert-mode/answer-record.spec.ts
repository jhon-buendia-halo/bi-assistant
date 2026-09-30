import { answerNumbers, pickAnswerRecord } from './answer-record';
import type { ToolDataRecord } from '../sessions/entities/session.entity';

const sql = (
  input: string,
  rows: Record<string, unknown>[],
  extra: Partial<ToolDataRecord> = {},
): ToolDataRecord => ({
  tool: 'run_readonly_sql',
  input,
  rows,
  rowCount: rows.length,
  columns: Object.keys(rows[0] ?? {}),
  ...extra,
});

describe('pickAnswerRecord', () => {
  it('returns undefined when nothing ran', () => {
    expect(pickAnswerRecord([], 'answer')).toBeUndefined();
    expect(pickAnswerRecord(undefined, 'answer')).toBeUndefined();
  });

  it('keeps the last successful query when the answer quotes nothing', () => {
    const first = sql('SELECT 1', [{ x: 1 }]);
    const last = sql('SELECT 2', [{ x: 2 }]);
    expect(pickAnswerRecord([first, last], 'No idea.')).toBe(last);
  });

  it('skips failed and non-SQL records', () => {
    const failed = sql('SELECT bad', [], { error: 'boom' });
    const sample: ToolDataRecord = { tool: 'sample_rows', rows: [{ a: 1 }] };
    const good = sql('SELECT 1', [{ x: 1 }]);
    expect(pickAnswerRecord([good, failed, sample], 'x')).toBe(good);
  });

  it('prefers the query whose figure the answer quotes over a later supporting count', () => {
    const average = sql('SELECT AVG(salary) FROM hr.v_salary_by_year', [
      { avg: 127520.6142 },
    ]);
    const count = sql('SELECT COUNT(DISTINCT e.id) FROM hr.employees e', [
      { count: 38 },
    ]);
    const answer =
      'The average base salary of tech employees in 2025 was $127,520.61 (over 38 employees).';
    expect(pickAnswerRecord([average, count], answer)).toBe(average);
  });

  it('matches rounded and percentage renderings', () => {
    const ratio = sql('SELECT terminated::float / headcount', [
      { attrition: 0.11538 },
    ]);
    const lookup = sql('SELECT COUNT(*) FROM hr.employees', [{ count: 104 }]);
    expect(
      pickAnswerRecord([ratio, lookup], 'Attrition in 2025 was 11.54%.'),
    ).toBe(ratio);
  });

  it('matches string values the answer names', () => {
    const departments = sql('SELECT d.name, COUNT(*) FROM ...', [
      { name: 'Engineering', headcount: 22 },
      { name: 'Sales', headcount: 22 },
    ]);
    const probe = sql('SELECT MAX(hired_on) FROM hr.employees', [
      { max: '2025-12-01' },
    ]);
    expect(
      pickAnswerRecord(
        [departments, probe],
        'Engineering and Sales tie with 22 active employees each.',
      ),
    ).toBe(departments);
  });

  it('is not fooled by years and currency codes in a lookup query', () => {
    const rates = sql(
      'SELECT year, currency, COUNT(*) AS cnt FROM hr.exchange_rates WHERE year = 2025 GROUP BY 1, 2',
      [
        { year: 2025, currency: 'EUR', cnt: '1' },
        { year: 2025, currency: 'GBP', cnt: '1' },
        { year: 2025, currency: 'USD', cnt: '1' },
      ],
    );
    const raise = sql('WITH hist AS (...) SELECT COUNT(*), AVG(...)', [
      { promotions_count: '12', avg_promotion_raise_usd: '8993.32' },
    ]);
    const count = sql('SELECT COUNT(*) FROM hr.salary_history WHERE ...', [
      { promotions_2025_employees: '12' },
    ]);
    const answer =
      'Average raise from promotions in 2025: $8,993.32 USD across 12 promotion events, converted from EUR and GBP at 2025 rates.';
    expect(pickAnswerRecord([rates, raise, count], answer)).toBe(raise);
  });

  it('prefers the query behind the headline figure over a richer breakdown', () => {
    const total = sql(
      'SELECT ROUND(SUM(...), 2) AS total_bonus_usd, COUNT(*) …',
      [
        {
          total_bonus_usd: '1761340.62',
          payment_count: '110',
          recipients: '97',
        },
      ],
    );
    const byType = sql('SELECT bonus_type, ROUND(SUM(...), 2), COUNT(*) …', [
      { bonus_type: 'annual', total_usd: '1701102.56', payments: '94' },
      { bonus_type: 'retention', total_usd: '40840.10', payments: '3' },
      { bonus_type: 'spot', total_usd: '19397.96', payments: '13' },
    ]);
    const answer =
      'FY2024 bonus payouts (USD): $1,761,340.62 — 110 payments to 97 employees. By type: annual $1,701,102.56 (94), retention $40,840.10 (3), spot $19,397.96 (13).';
    expect(pickAnswerRecord([total, byType], answer)).toBe(total);
  });

  it('keeps the latest on an exact tie', () => {
    const a = sql('SELECT 42', [{ x: 42 }]);
    const b = sql('SELECT 42 AS again', [{ y: 42 }]);
    expect(pickAnswerRecord([a, b], 'The answer is 42.')).toBe(b);
  });
});

describe('answerNumbers', () => {
  it('strips currency formatting and keeps decimals', () => {
    expect(answerNumbers('$1,761,340.62 across 94 bonuses (11.54%)')).toEqual([
      1761340.62, 94, 11.54,
    ]);
  });
});
