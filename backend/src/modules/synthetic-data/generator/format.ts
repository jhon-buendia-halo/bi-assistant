// Locale-free formatting (plan 2.4, 7): decimals through integer arithmetic (never
// toString of a non-integer, never an exponent), timestamps from epoch milliseconds.

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/**
 * `x` rounded to `scale` decimals as plain decimal text. The rounding happens once on
 * the scaled integer; digits come from BigInt, so no exponent ever appears.
 */
export function formatDecimal(x: number, scale: number): string {
  let s = Math.max(0, Math.min(10, Math.floor(scale)));
  // Keep the scaled integer exact (below 2^53).
  while (s > 0 && Math.abs(x) * 10 ** s >= 9007199254740991) s--;
  const scaled = Math.round(x * 10 ** s);
  const negative = scaled < 0;
  const digits = BigInt(Math.abs(scaled)).toString();
  if (s === 0) return (negative && scaled !== 0 ? '-' : '') + digits;
  const padded = digits.padStart(s + 1, '0');
  const body = `${padded.slice(0, padded.length - s)}.${padded.slice(padded.length - s)}`;
  return (negative ? '-' : '') + body;
}

/** Round `x` to `scale` decimals as a number (same rule as formatDecimal). */
export function roundTo(x: number, scale: number): number {
  return Number(formatDecimal(x, scale));
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** `YYYY-MM-DD HH:MM:SS[.ffffff]`, UTC. */
export function formatTimestamp(ms: number, fraction: boolean): string {
  const d = new Date(ms);
  const base =
    `${formatDate(ms)} ${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:` +
    pad(d.getUTCSeconds(), 2);
  return fraction ? `${base}.${pad(d.getUTCMilliseconds(), 3)}000` : base;
}

/** Base-36 text of a non-negative integer, left-padded to `width`. */
export function base36(n: number, width: number): string {
  return n.toString(36).padStart(width, '0');
}

/** The declared maximum length of a character type (`char(3)`, `varchar(50)`), if any. */
export function declaredMaxLength(type: string): number | undefined {
  const m =
    /^\s*(?:character varying|varchar|character|char|bpchar|nvarchar|nchar|string)\s*\(\s*(\d+)\s*\)/i.exec(
      type,
    );
  return m ? Number(m[1]) : undefined;
}
