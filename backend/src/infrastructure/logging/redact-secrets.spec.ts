import { inspect } from 'node:util';
import { redactLogValue, redactSecrets } from './redact-secrets';
import { REDACTION_SAMPLES } from './redact-secrets.samples';

describe('redactSecrets', () => {
  it.each(REDACTION_SAMPLES)('$name', ({ input, expected }) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const { expected } of REDACTION_SAMPLES) {
      expect(redactSecrets(expected)).toBe(expected);
    }
  });

  it('stringifies non-string input', () => {
    expect(redactSecrets(42)).toBe('42');
  });
});

describe('redactLogValue', () => {
  it('redacts strings', () => {
    expect(redactLogValue('Authorization: Bearer abc')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('copies plain objects and arrays, redacting secret fields and strings', () => {
    const headers = {
      Authorization: 'Bearer abc',
      'x-api-key': 'k-123',
      apiKey: 'short',
      accept: 'application/json',
      nested: [{ password: 'p' }, 'note sk-ant-0123456789abcdefgh', 7],
      count: 3,
    };
    expect(redactLogValue(headers)).toEqual({
      Authorization: 'Bearer [REDACTED]',
      'x-api-key': '[REDACTED]',
      apiKey: '[REDACTED]',
      accept: 'application/json',
      nested: [{ password: '[REDACTED]' }, 'note [REDACTED]', 7],
      count: 3,
    });
    // The original is left untouched.
    expect(headers.Authorization).toBe('Bearer abc');
  });

  it('masks a schemeless Authorization field whole', () => {
    expect(redactLogValue({ authorization: 'abc' })).toEqual({
      authorization: '[REDACTED]',
    });
  });

  it('copies an Error with a redacted message and stack', () => {
    const error = new TypeError('bad key sk-proj-0123456789abcdefXYZ');
    const copy = redactLogValue(error) as Error;
    expect(copy).toBeInstanceOf(Error);
    expect(copy.name).toBe('TypeError');
    expect(copy.message).toBe('bad key [REDACTED]');
    expect(copy.stack).toContain('bad key [REDACTED]');
    expect(copy.stack).not.toContain('sk-proj-');
  });

  it('handles cycles', () => {
    const value: Record<string, unknown> = { token: 't' };
    value.self = value;
    const copy = redactLogValue(value) as Record<string, unknown>;
    expect(copy.token).toBe('[REDACTED]');
    expect(copy.self).toBe(copy);
  });

  it('passes other values through', () => {
    const date = new Date(0);
    expect(redactLogValue(date)).toBe(date);
    expect(redactLogValue(5)).toBe(5);
    expect(redactLogValue(null)).toBeNull();
    expect(redactLogValue(undefined)).toBeUndefined();
  });
});

describe('redaction review fixes', () => {
  it('copies a DOMException into a readable Error', () => {
    const error = new DOMException(
      'timed out for sk-proj-0123456789abcdefXYZ',
      'TimeoutError',
    );
    const copy = redactLogValue(error) as Error;
    expect(Object.prototype.toString.call(copy)).toBe('[object Error]');
    expect(copy.name).toBe('TimeoutError');
    expect(copy.message).toBe('timed out for [REDACTED]');
    expect(String(copy.stack ?? '')).not.toContain('sk-proj-');
  });

  it('copies an error whose message getter needs a private field', () => {
    class SlotError extends Error {
      readonly #text: string;
      constructor(text: string) {
        super();
        this.#text = text;
      }
      override get message(): string {
        return this.#text;
      }
    }
    const copy = redactLogValue(new SlotError('token: abc')) as Error;
    expect(copy.message).toBe('token: [REDACTED]');
  });

  it('keeps an empty-message Error an ordinary copy', () => {
    const copy = redactLogValue(new RangeError()) as Error;
    expect(copy).toBeInstanceOf(RangeError);
    expect(copy.message).toBe('');
  });

  it('does not redact across lines from an unclosed quote', () => {
    const input = "line1 password: 'it\nline2 user ok\nline3 don't";
    expect(redactSecrets(input)).toBe(
      "line1 password: '[REDACTED]\nline2 user ok\nline3 don't",
    );
  });

  it('leaves JSON null and booleans of secret fields valid', () => {
    const json = '{"token":null,"password":false,"authorization":true}';
    expect(JSON.parse(redactSecrets(json))).toEqual({
      token: null,
      password: false,
      authorization: true,
    });
    expect(redactSecrets('password: true-ish')).toBe('password: [REDACTED]');
  });

  it('serialises a class instance with null secret fields', () => {
    class Settings {
      token = null;
      apiKey = 'sk-0123456789abcdefghij';
      model = 'gpt-5';
    }
    const view = redactLogValue(new Settings());
    expect(JSON.parse(JSON.stringify(view))).toEqual({
      token: null,
      apiKey: '[REDACTED]',
      model: 'gpt-5',
    });
  });

  it('wraps deep and large values instead of copying them', () => {
    const big = Array.from({ length: 500 }, (_, i) => `x-api-key: k${i}`);
    const view = redactLogValue(big);
    expect(Array.isArray(view)).toBe(false);
    const printed = inspect(view);
    expect(printed).toContain("'x-api-key: [REDACTED]'");
    expect(printed).not.toContain('k0');
    expect(JSON.stringify(view)).not.toContain('k499');

    let deep: Record<string, unknown> = { secret: 's' };
    for (let i = 0; i < 10; i++) deep = { next: deep };
    const out = JSON.stringify(redactLogValue(deep));
    expect(out).toContain('"secret":"[REDACTED]"');
  });
});
