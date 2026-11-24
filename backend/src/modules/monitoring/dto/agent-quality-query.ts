import { BadRequestException } from '@nestjs/common';

/** The raw query string of `GET /monitoring/agent-quality`. */
export interface AgentQualityQuery {
  agent?: string;
  set?: string;
  model?: string;
  from?: string;
  to?: string;
}

export interface ParsedAgentQualityQuery {
  agent?: string;
  set?: string;
  model?: string;
  from: Date | null;
  to: Date;
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

/** Validates the query; throws 400 with the contract's messages. */
export function parseAgentQualityQuery(
  query: AgentQualityQuery = {},
  now: Date = new Date(),
): ParsedAgentQualityQuery {
  const from = date(query.from, 'From is not a valid date');
  const to = date(query.to, 'To is not a valid date') ?? now;
  if (from && from > to) {
    throw new BadRequestException('From must not be after To');
  }
  return {
    agent: value(query.agent),
    set: value(query.set),
    model: value(query.model),
    from: from ?? null,
    to,
  };
}
