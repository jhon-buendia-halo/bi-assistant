import type { FormatRule } from '../engine/types';

/**
 * The format rule a text column gets from its name, case-insensitively, first
 * match wins (spec R9).
 */
export function detectFormatRule(name: string): FormatRule | undefined {
  const n = name.toLowerCase();
  if (n.includes('email')) return 'email';
  if (/(phone|mobile|^tel$|_tel$|telephone)/.test(n)) return 'phone';
  if (/(url|website|^link$|_link$)/.test(n)) return 'url';
  if (/(uuid|guid)/.test(n)) return 'uuid';
  if (/(?:(?:^|_)date(?:$|_))|(?:date$)/.test(n)) return 'date-string';
  return undefined;
}

/**
 * Postgres (POSIX) patterns. The connector matches them case-insensitively.
 */
export const POSTGRES_FORMAT_PATTERNS: Record<FormatRule, string> = {
  email: '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$',
  phone: '^[+0-9().[:space:]-]{7,}$',
  url: '^https?://',
  uuid: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'date-string': '^[0-9]{4}-[0-9]{2}-[0-9]{2}',
};

/**
 * Databricks (Java regex) patterns. The connector matches them
 * case-insensitively.
 */
export const DATABRICKS_FORMAT_PATTERNS: Record<FormatRule, string> = {
  email: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
  phone: '^[+0-9().\\s-]{7,}$',
  url: '^https?://',
  uuid: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'date-string': '^\\d{4}-\\d{2}-\\d{2}',
};
