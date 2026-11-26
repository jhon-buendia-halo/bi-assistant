import {
  DATABRICKS_FORMAT_PATTERNS,
  detectFormatRule,
  POSTGRES_FORMAT_PATTERNS,
} from './format-rules';

describe('detectFormatRule', () => {
  it.each([
    ['email', 'email'],
    ['Customer_Email', 'email'],
    ['phone', 'phone'],
    ['mobile_number', 'phone'],
    ['tel', 'phone'],
    ['home_tel', 'phone'],
    ['telephone', 'phone'],
    ['url', 'url'],
    ['website', 'url'],
    ['link', 'url'],
    ['profile_link', 'url'],
    ['uuid', 'uuid'],
    ['row_guid', 'uuid'],
    ['date', 'date-string'],
    ['order_date', 'date-string'],
    ['date_of_birth', 'date-string'],
    ['birth_date_text', 'date-string'],
    ['startdate', 'date-string'],
    // First match wins: email beats url.
    ['email_url', 'email'],
  ])('%s → %s', (name, rule) => {
    expect(detectFormatRule(name)).toBe(rule);
  });

  it.each(['name', 'hotel', 'linked_id', 'dated_at', 'status'])(
    '%s has no rule',
    (name) => {
      expect(detectFormatRule(name)).toBeUndefined();
    },
  );
});

describe('format patterns', () => {
  it('Postgres uses POSIX classes', () => {
    expect(POSTGRES_FORMAT_PATTERNS).toEqual({
      email: '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$',
      phone: '^[+0-9().[:space:]-]{7,}$',
      url: '^https?://',
      uuid: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      'date-string': '^[0-9]{4}-[0-9]{2}-[0-9]{2}',
    });
  });

  it('Databricks uses Java regex', () => {
    expect(DATABRICKS_FORMAT_PATTERNS).toEqual({
      email: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      phone: '^[+0-9().\\s-]{7,}$',
      url: '^https?://',
      uuid: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      'date-string': '^\\d{4}-\\d{2}-\\d{2}',
    });
  });

  // The Java patterns are also valid JS regexes: check them against the spec
  // (R9), matched case-insensitively.
  it.each([
    ['email', 'a@b.co', true],
    ['email', 'a@b', false],
    ['phone', '+1 (555) 010-2000', true],
    ['phone', '12-34', false],
    ['url', 'HTTPS://x.io', true],
    ['url', 'ftp://x.io', false],
    ['uuid', '123E4567-E89B-12D3-A456-426614174000', true],
    ['uuid', '123e4567', false],
    ['date-string', '2024-01-31T00:00', true],
    ['date-string', '31/01/2024', false],
  ] as const)('%s matches %s: %s', (rule, value, ok) => {
    expect(new RegExp(DATABRICKS_FORMAT_PATTERNS[rule], 'i').test(value)).toBe(
      ok,
    );
  });
});
