import { BadRequestException } from '@nestjs/common';
import { parseLlmCallsQuery } from './llm-calls-query';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('expected a 400');
}

describe('parseLlmCallsQuery', () => {
  it('defaults to page 1 of 25 with no filters', () => {
    expect(parseLlmCallsQuery({})).toEqual({
      page: 1,
      pageSize: 25,
      filter: {
        agent: undefined,
        model: undefined,
        provider: undefined,
        status: undefined,
        session: undefined,
        from: undefined,
        to: undefined,
      },
    });
  });

  it('treats blank values as absent', () => {
    const parsed = parseLlmCallsQuery({
      page: '',
      pageSize: '',
      agent: '',
      status: ' ',
      from: '',
    });
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.filter.agent).toBeUndefined();
    expect(parsed.filter.status).toBeUndefined();
    expect(parsed.filter.from).toBeUndefined();
  });

  it('reads every filter', () => {
    const parsed = parseLlmCallsQuery({
      page: '3',
      pageSize: '100',
      agent: 'assistant',
      model: 'claude-sonnet-5-5',
      provider: 'anthropic.messages',
      status: 'failed',
      session: 's-1',
      from: '2026-11-10T19:00:00.000Z',
      to: '2026-11-10T20:00:00Z',
    });
    expect(parsed).toEqual({
      page: 3,
      pageSize: 100,
      filter: {
        agent: 'assistant',
        model: 'claude-sonnet-5-5',
        provider: 'anthropic.messages',
        status: 'failed',
        session: 's-1',
        from: new Date('2026-11-10T19:00:00.000Z'),
        to: new Date('2026-11-10T20:00:00.000Z'),
      },
    });
  });

  it.each(['0', '-1', '1.5', 'abc', '2x'])('rejects page %p', (page) => {
    expect(messageOf(() => parseLlmCallsQuery({ page }))).toBe(
      'Page must be a positive whole number',
    );
  });

  it.each(['10', '0', '26', 'x', '25.0'])('rejects page size %p', (size) => {
    expect(messageOf(() => parseLlmCallsQuery({ pageSize: size }))).toBe(
      'Page size must be 25, 50 or 100',
    );
  });

  it('accepts the three page sizes', () => {
    for (const size of ['25', '50', '100']) {
      expect(parseLlmCallsQuery({ pageSize: size }).pageSize).toBe(
        Number(size),
      );
    }
  });

  it('rejects an unknown status', () => {
    expect(messageOf(() => parseLlmCallsQuery({ status: 'done' }))).toBe(
      'Status must be succeeded, failed or running',
    );
  });

  it('rejects dates that do not parse', () => {
    expect(messageOf(() => parseLlmCallsQuery({ from: 'yesterday' }))).toBe(
      'From is not a valid date',
    );
    expect(messageOf(() => parseLlmCallsQuery({ to: '2026-13-45' }))).toBe(
      'To is not a valid date',
    );
  });
});
