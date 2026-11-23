import { BadRequestException } from '@nestjs/common';
import { parseAgentQualityQuery } from './agent-quality-query';

const NOW = new Date('2026-11-22T12:00:00Z');

describe('parseAgentQualityQuery', () => {
  it('defaults to all time up to now, with no filters', () => {
    expect(parseAgentQualityQuery({}, NOW)).toEqual({
      agent: undefined,
      set: undefined,
      model: undefined,
      from: null,
      to: NOW,
    });
  });

  it('reads trimmed filters and dates, ignoring blanks', () => {
    const parsed = parseAgentQualityQuery(
      {
        agent: ' assistant ',
        set: '',
        model: 'Unknown',
        from: '2026-11-01T00:00:00Z',
        to: '2026-11-10T00:00:00Z',
      },
      NOW,
    );
    expect(parsed.agent).toBe('assistant');
    expect(parsed.set).toBeUndefined();
    expect(parsed.model).toBe('Unknown');
    expect(parsed.from).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(parsed.to).toEqual(new Date('2026-11-10T00:00:00Z'));
  });

  it('accepts from equal to to', () => {
    expect(() =>
      parseAgentQualityQuery(
        { from: '2026-11-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
        NOW,
      ),
    ).not.toThrow();
  });

  it.each([
    [{ from: 'nope' }, 'From is not a valid date'],
    [{ to: 'nope' }, 'To is not a valid date'],
    [
      { from: '2026-11-10T00:00:00Z', to: '2026-11-01T00:00:00Z' },
      'From must not be after To',
    ],
    [{ from: '2027-01-01T00:00:00Z' }, 'From must not be after To'],
  ])('rejects %j with %s', (query, message) => {
    expect(() => parseAgentQualityQuery(query, NOW)).toThrow(
      new BadRequestException(message),
    );
  });
});
