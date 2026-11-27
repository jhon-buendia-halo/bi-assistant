// Checks computed in code over sampled rows: invalid formats, sentinel
// values, PII patterns and coded values. Each returns counts and rates only;
// no sampled value ever leaves this file (guardrail 7.1). Pure.
import {
  DATABRICKS_FORMAT_PATTERNS,
  detectFormatRule,
} from '../synthetic-data/profile/format-rules';
import type { FormatRule } from '../synthetic-data/types';
import {
  PII_MIN_MATCHES,
  PII_MIN_RATE,
  PII_UNHINTED_RATE,
  SENTINEL_NUMBER,
  SENTINEL_TEXT,
} from './rubric';

export type PiiType = 'email' | 'phone' | 'card-number' | 'national-id';

/** The non-null, non-blank values of a column. */
export function presentValues(
  rows: Record<string, unknown>[],
  column: string,
): unknown[] {
  return rows
    .map((r) => r[column])
    .filter(
      (v) =>
        v !== null &&
        v !== undefined &&
        !(typeof v === 'string' && v.trim() === ''),
    );
}

const asText = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v);

/** The anchored format rule a column's name implies (reused from the profiler). */
export function formatRuleFor(column: string): FormatRule | undefined {
  return detectFormatRule(column);
}

/** Share of values that do not match the column's format rule. */
export function invalidFormat(
  values: unknown[],
  rule: FormatRule,
): { checked: number; invalid: number; rate: number } {
  const pattern = new RegExp(DATABRICKS_FORMAT_PATTERNS[rule], 'i');
  const texts = values.filter((v) => typeof v === 'string');
  const invalid = texts.filter((v) => !pattern.test(v.trim())).length;
  return {
    checked: texts.length,
    invalid,
    rate: texts.length ? invalid / texts.length : 0,
  };
}

function isSentinel(v: unknown): boolean {
  if (typeof v === 'number') return v === SENTINEL_NUMBER;
  if (typeof v === 'bigint') return v === BigInt(SENTINEL_NUMBER);
  if (v instanceof Date) {
    const iso = v.toISOString().slice(0, 10);
    return iso === '1900-01-01' || iso === '9999-12-31';
  }
  if (typeof v !== 'string') return false;
  const t = v.trim().toLowerCase();
  return (
    SENTINEL_TEXT.includes(t) ||
    t.startsWith('1900-01-01') ||
    t.startsWith('9999-12-31') ||
    t === String(SENTINEL_NUMBER)
  );
}

/** Share of values that are sentinels (-1, 'N/A', 'test', 1900-01-01, 9999-12-31). */
export function sentinels(values: unknown[]): {
  checked: number;
  sentinels: number;
  rate: number;
} {
  const n = values.filter(isSentinel).length;
  return {
    checked: values.length,
    sentinels: n,
    rate: values.length ? n / values.length : 0,
  };
}

// PII ---------------------------------------------------------------------

const NAME_HINTS: Record<PiiType, RegExp> = {
  email: /e[-_]?mail|correo/i,
  phone: /phone|mobile|(^|_)tel($|_)|telefono|celular|movil/i,
  'card-number': /card|(^|_)pan($|_)|cc_?num|tarjeta/i,
  'national-id':
    /ssn|(^|_)dni($|_)|cedula|national_?id|(^|_)nif($|_)|(^|_)nie($|_)|curp|(^|_)rut($|_)|(^|_)cpf($|_)|passport|pasaporte|tax_?id|(^|_)nit($|_)/i,
};

/** Personal data a column name suggests that no pattern can confirm. */
const NAME_ONLY_HINT =
  /(first|last|full|given|family|sur)_?name|nombre|apellido|address|direccion|birth|nacimiento/i;

// The profiler's email rule, unanchored, to find an address inside free text.
const EMAIL_IN_TEXT = new RegExp(
  DATABRICKS_FORMAT_PATTERNS.email.replace(/^\^/, '').replace(/\$$/, ''),
  'i',
);
const PHONE = new RegExp(DATABRICKS_FORMAT_PATTERNS.phone, 'i');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const CARD_IN_TEXT = /(?:\d[ -]?){12,18}\d/g;

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function hasCard(text: string): boolean {
  for (const m of text.match(CARD_IN_TEXT) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

function isPhone(text: string, hinted: boolean): boolean {
  const t = text.trim();
  if (ISO_DATE.test(t) || !PHONE.test(t)) return false;
  const digits = t.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return false;
  // Without a name hint only a formatted number counts (not a bare integer id).
  return hinted || /[+()\s-]/.test(t);
}

function isNationalId(text: string): boolean {
  const digits = text.replace(/[\s.-]/g, '');
  return /^[A-Z]{0,2}\d{5,15}[A-Z]?$/i.test(digits);
}

const MATCHERS: Record<PiiType, (text: string, hinted: boolean) => boolean> = {
  email: (t) => EMAIL_IN_TEXT.test(t),
  phone: isPhone,
  'card-number': (t) => hasCard(t),
  'national-id': (t, hinted) => hinted && isNationalId(t),
};

export interface PiiColumn {
  column: string;
  type: PiiType;
  matchRate: number;
  checked: number;
  hinted: boolean;
}

/**
 * The PII a column's sample shows: the type and its match rate, never a
 * value. Without a name hint, number-like types must match most values.
 */
export function scanPii(
  column: string,
  values: unknown[],
): PiiColumn | undefined {
  const texts = values
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map(asText);
  if (!texts.length) return undefined;
  for (const type of Object.keys(MATCHERS) as PiiType[]) {
    const hinted = NAME_HINTS[type].test(column);
    const matches = texts.filter((t) => MATCHERS[type](t, hinted)).length;
    const rate = matches / texts.length;
    const minRate =
      hinted || type === 'email' ? PII_MIN_RATE : PII_UNHINTED_RATE;
    if (matches >= Math.min(PII_MIN_MATCHES, texts.length) && rate >= minRate) {
      return { column, type, matchRate: rate, checked: texts.length, hinted };
    }
  }
  return undefined;
}

/** A column name that suggests personal data no pattern checks (names, addresses). */
export function nameOnlyPiiHint(column: string): boolean {
  return NAME_ONLY_HINT.test(column);
}

/**
 * A coded column: few distinct short values (e.g. status 1, 2, 3) that need a
 * dictionary to be read. Booleans are not codes.
 */
export function looksCoded(values: unknown[]): boolean {
  if (values.length < 20) return false;
  if (values.some((v) => typeof v === 'boolean')) return false;
  const distinct = new Set(values.map(asText));
  if (distinct.size < 2 || distinct.size > 10) return false;
  return [...distinct].every(
    (v) => /^-?\d{1,2}$/.test(v) || /^[A-Z0-9]{1,3}$/i.test(v),
  );
}
