import { redact } from './ledger';
import {
  invalidFormat,
  looksCoded,
  luhn,
  scanPii,
  sentinels,
} from './sample-checks';

const range = (n: number, f: (i: number) => unknown) =>
  Array.from({ length: n }, (_, i) => f(i));

describe('sample checks', () => {
  it('finds emails inside free text and reports only the type and rate', () => {
    const values = range(100, (i) =>
      i % 10 === 0 ? `write to someone${i}@example.org` : 'all good',
    );
    expect(scanPii('notes', values)).toEqual({
      column: 'notes',
      type: 'email',
      matchRate: 0.1,
      checked: 100,
      hinted: false,
    });
  });

  it('raises no PII on integer ids, amounts, ISO dates or plain words', () => {
    expect(
      scanPii(
        'id',
        range(200, (i) => i + 1_000_000),
      ),
    ).toBeUndefined();
    expect(
      scanPii(
        'amount',
        range(200, (i) => i * 1.5),
      ),
    ).toBeUndefined();
    expect(
      scanPii(
        'order_date',
        range(200, () => '2026-11-25'),
      ),
    ).toBeUndefined();
    expect(
      scanPii(
        'segment',
        range(200, (i) => `Segment ${i % 5}`),
      ),
    ).toBeUndefined();
  });

  it('detects card numbers with the Luhn check and phones by format or name', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(
      scanPii(
        'payment',
        range(50, () => '4111 1111 1111 1111'),
      )?.type,
    ).toBe('card-number');
    expect(
      scanPii(
        'contact',
        range(50, (i) => `+57 300 555 ${1000 + i}`),
      )?.type,
    ).toBe('phone');
  });

  it('needs a column-name hint for national ids', () => {
    const ids = range(50, (i) => `${10_000_000 + i}`);
    expect(scanPii('cedula', ids)?.type).toBe('national-id');
    expect(scanPii('reference', ids)).toBeUndefined();
  });

  it('measures invalid formats with the profiler rules and sentinel values', () => {
    expect(invalidFormat(['a@b.co', 'nope', 'c@d.io', 'x'], 'email')).toEqual({
      checked: 4,
      invalid: 2,
      rate: 0.5,
    });
    expect(
      sentinels(['N/A', 'test', 'ok', -1, '9999-12-31', 3]).sentinels,
    ).toBe(4);
  });

  it('recognises coded columns', () => {
    expect(looksCoded(range(40, (i) => i % 3))).toBe(true);
    expect(looksCoded(range(40, (i) => i))).toBe(false);
    expect(looksCoded(range(40, (i) => i % 2 === 0))).toBe(false);
  });

  it('redacts personal values a database error could echo', () => {
    expect(
      redact(
        'invalid input syntax for type integer: "jane@example.com"\nLINE 1',
      ),
    ).toBe('invalid input syntax for type integer: "[redacted]"');
    expect(redact('value +57 300 555 1234 rejected')).toBe(
      'value [redacted] rejected',
    );
  });
});
