import { BadRequestException } from '@nestjs/common';

/** The raw query string of `GET /monitoring/usage`. */
export interface UsageQuery {
  from?: string;
  to?: string;
  tz?: string;
}

export interface ParsedUsageQuery {
  from: Date | null;
  to: Date;
  timeZone: string;
}

function value(raw: unknown): string | undefined {
  if (Array.isArray(raw)) return value(raw[0]);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function date(raw: unknown, message: string): Date | undefined {
  const text = value(raw);
  if (text === undefined) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(message);
  return parsed;
}

/** True when `Intl` knows the IANA time zone. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the usage query; throws 400 with the contract's messages. `to`
 * defaults to now and `tz` to UTC.
 */
export function parseUsageQuery(
  query: UsageQuery = {},
  now: Date = new Date(),
): ParsedUsageQuery {
  const from = date(query.from, 'From is not a valid date') ?? null;
  const to = date(query.to, 'To is not a valid date') ?? now;
  if (from && from > to) {
    throw new BadRequestException('From must not be after To');
  }
  const timeZone = value(query.tz) ?? 'UTC';
  if (!isTimeZone(timeZone)) {
    throw new BadRequestException('Time zone is not valid');
  }
  return { from, to, timeZone };
}
