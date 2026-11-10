import type { SessionFilter } from '../repositories/span-events.repository';
import { parseLlmCallsQuery } from './llm-calls-query';

/** The raw query string of `GET /monitoring/sessions`. */
export interface SessionsQuery {
  page?: string;
  pageSize?: string;
  agent?: string;
  from?: string;
  to?: string;
}

export interface ParsedSessionsQuery {
  page: number;
  pageSize: number;
  filter: SessionFilter;
}

/**
 * Validates the sessions query with the LLM calls list's rules and messages
 * (page, page size 25/50/100, dates); other parameters are ignored.
 */
export function parseSessionsQuery(
  query: SessionsQuery = {},
): ParsedSessionsQuery {
  const { page, pageSize, filter } = parseLlmCallsQuery({
    page: query.page,
    pageSize: query.pageSize,
    agent: query.agent,
    from: query.from,
    to: query.to,
  });
  return {
    page,
    pageSize,
    filter: { agent: filter.agent, from: filter.from, to: filter.to },
  };
}

/** `framework=true` (or `1`) shows the framework spans; anything else hides them. */
export function parseFrameworkFlag(raw: unknown): boolean {
  const text = Array.isArray(raw) ? (raw[0] as unknown) : raw;
  return typeof text === 'string' && ['true', '1'].includes(text.trim());
}
