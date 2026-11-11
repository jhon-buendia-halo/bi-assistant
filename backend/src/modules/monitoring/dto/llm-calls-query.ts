import { BadRequestException } from '@nestjs/common';
import {
  LLM_CALL_STATUSES,
  type LlmCallStatus,
} from '../entities/llm-call.entity';
import type { LlmCallFilter } from '../repositories/span-events.repository';

/** The raw query string of `GET /monitoring/llm-calls`. */
export interface LlmCallsQuery {
  page?: string;
  pageSize?: string;
  agent?: string;
  model?: string;
  provider?: string;
  status?: string;
  session?: string;
  from?: string;
  to?: string;
}

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface ParsedLlmCallsQuery {
  page: number;
  pageSize: number;
  filter: LlmCallFilter;
}

/** A query value, or undefined when absent or blank. */
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

/** Validates the list query; throws 400 with the contract's messages. */
export function parseLlmCallsQuery(
  query: LlmCallsQuery = {},
): ParsedLlmCallsQuery {
  const pageText = value(query.page);
  let page = 1;
  if (pageText !== undefined) {
    page = /^\d+$/.test(pageText) ? Number(pageText) : NaN;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new BadRequestException('Page must be a positive whole number');
    }
  }

  const sizeText = value(query.pageSize);
  let pageSize: number = DEFAULT_PAGE_SIZE;
  if (sizeText !== undefined) {
    pageSize = Number(sizeText);
    if (
      !/^\d+$/.test(sizeText) ||
      !(PAGE_SIZES as readonly number[]).includes(pageSize)
    ) {
      throw new BadRequestException('Page size must be 25, 50 or 100');
    }
  }

  const statusText = value(query.status);
  if (
    statusText !== undefined &&
    !LLM_CALL_STATUSES.includes(statusText as LlmCallStatus)
  ) {
    throw new BadRequestException(
      'Status must be succeeded, failed or running',
    );
  }

  const filter: LlmCallFilter = {
    agent: value(query.agent),
    model: value(query.model),
    provider: value(query.provider),
    status: statusText as LlmCallStatus | undefined,
    session: value(query.session),
    from: date(query.from, 'From is not a valid date'),
    to: date(query.to, 'To is not a valid date'),
  };
  return { page, pageSize, filter };
}
