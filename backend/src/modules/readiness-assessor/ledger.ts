// The assessment's ledger: evidence (EV-001…) and findings (F-001…) numbered
// in the order they are recorded, plus the measurement context every
// measure-*.ts file runs its statements through.
import type {
  ReadinessEvidence,
  ReadinessFinding,
  ReadinessPort,
  ReadinessScope,
} from './readiness.types';

const pad = (n: number) => String(n).padStart(3, '0');

export class Ledger {
  readonly evidence: ReadinessEvidence[] = [];
  readonly findings: ReadinessFinding[] = [];
  readonly notEvaluated: { item: string; reason: string }[] = [];

  addEvidence(e: Omit<ReadinessEvidence, 'id'>): string {
    const id = `EV-${pad(this.evidence.length + 1)}`;
    this.evidence.push({ id, ...e });
    return id;
  }

  addFinding(f: Omit<ReadinessFinding, 'id'>): string {
    const id = `F-${pad(this.findings.length + 1)}`;
    this.findings.push({ id, ...f });
    return id;
  }

  addNotEvaluated(item: string, reason: string): void {
    if (!this.notEvaluated.some((n) => n.item === item)) {
      this.notEvaluated.push({ item, reason: redact(reason) });
    }
  }
}

const EMAIL_LIKE = /[^@\s'"]+@[^@\s'"]+\.[^@\s'"]+/g;
const DIGIT_RUN = /\+?\d[\d\s().-]{5,}\d/g;

/**
 * An error text made safe for the assessment (guardrail 7.1): an email-like
 * token or a long digit run (a phone, card or id) a database echoed back is
 * replaced, and the text is cut to one short line.
 */
export function redact(text: string): string {
  const line = text.split('\n')[0].trim();
  const safe = line
    .replace(EMAIL_LIKE, '[redacted]')
    .replace(DIGIT_RUN, '[redacted]');
  return safe.length > 200 ? `${safe.slice(0, 197)}...` : safe;
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface MeasureContext {
  scope: ReadinessScope;
  port: ReadinessPort;
  ledger: Ledger;
  now: Date;
  signal?: AbortSignal;
}

/** Stop the run when the caller aborted (the only error that propagates). */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const reason: unknown = signal.reason;
    throw reason instanceof Error
      ? reason
      : new DOMException('The assessment was aborted', 'AbortError');
  }
}

/**
 * Run one measurement. A failure becomes `{ ok: false, reason }` (an N/E
 * with its reason), never a throw, unless the run was aborted.
 */
export async function attempt<T>(
  ctx: MeasureContext,
  work: () => Promise<T>,
): Promise<Attempt<T>> {
  throwIfAborted(ctx.signal);
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    throwIfAborted(ctx.signal);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: redact(message || 'unknown error') };
  }
}

/** A result value as a number (drivers return bigint, numeric strings or null). */
export function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A date-like result value (Date, ISO string, `YYYY-MM-DD`) as a Date. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A row value read case-insensitively (Postgres folds unquoted aliases). */
export function field(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name];
  const key = Object.keys(row).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key === undefined ? undefined : row[key];
}

export const round = (n: number, digits = 4) =>
  Math.round(n * 10 ** digits) / 10 ** digits;

export const pct = (rate: number) => `${round(rate * 100, 1)}%`;
