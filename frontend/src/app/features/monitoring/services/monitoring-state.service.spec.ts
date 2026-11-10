import { TestBed } from '@angular/core/testing';
import { EMPTY_FILTERS, toQuery } from '../models/llm-call.model';
import { MonitoringStateService } from './monitoring-state.service';

describe('MonitoringStateService', () => {
  let state: MonitoringStateService;

  beforeEach(() => {
    state = TestBed.inject(MonitoringStateService);
  });

  it('starts with no filters on page 1 of 25 rows', () => {
    expect(state.filters()).toEqual(EMPTY_FILTERS);
    expect(state.page()).toBe(1);
    expect(state.pageSize()).toBe(25);
    expect(state.hasFilters()).toBeFalse();
  });

  it('goes back to page 1 when a filter changes', () => {
    state.setPage(3);
    state.setFilter('agent', 'assistant');
    expect(state.page()).toBe(1);
    expect(state.filters().agent).toBe('assistant');
    expect(state.hasFilters()).toBeTrue();
  });

  it('goes back to page 1 when the page size changes', () => {
    state.setPage(4);
    state.setPageSize(50);
    expect(state.page()).toBe(1);
    expect(state.pageSize()).toBe(50);
  });

  it('clears every filter and returns to page 1', () => {
    state.setFilter('status', 'failed');
    state.setFilter('range', 'custom');
    state.setFilter('from', '2026-11-01T10:00');
    state.setPage(2);
    state.clearFilters();
    expect(state.filters()).toEqual(EMPTY_FILTERS);
    expect(state.page()).toBe(1);
    expect(state.hasFilters()).toBeFalse();
  });

  it('forgets the custom dates when another range is chosen', () => {
    state.setFilter('range', 'custom');
    state.setFilter('from', '2026-11-01T10:00');
    state.setFilter('to', '2026-11-02T10:00');
    state.setFilter('range', 'day');
    expect(state.filters().from).toBe('');
    expect(state.filters().to).toBe('');
  });

  it('is one app-wide instance, so the filters are kept across views', () => {
    state.setFilter('model', 'claude-opus-5-5');
    state.setPage(2);
    const again = TestBed.inject(MonitoringStateService);
    expect(again.filters().model).toBe('claude-opus-5-5');
    expect(again.page()).toBe(2);
  });
});

describe('toQuery', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');

  it('sends only the filters that are set', () => {
    expect(toQuery(EMPTY_FILTERS, 2, 50, now)).toEqual({ page: 2, pageSize: 50 });
    expect(
      toQuery(
        { ...EMPTY_FILTERS, agent: 'assistant', status: 'failed', session: 's1' },
        1,
        25,
        now,
      ),
    ).toEqual({
      page: 1,
      pageSize: 25,
      agent: 'assistant',
      status: 'failed',
      session: 's1',
    });
  });

  it('turns a relative range into a from date ending now', () => {
    expect(toQuery({ ...EMPTY_FILTERS, range: 'hour' }, 1, 25, now).from).toBe(
      '2026-11-10T11:00:00.000Z',
    );
    expect(toQuery({ ...EMPTY_FILTERS, range: 'week' }, 1, 25, now).from).toBe(
      '2026-11-03T12:00:00.000Z',
    );
  });

  it('sends the custom dates as ISO, skipping blank ones', () => {
    const query = toQuery(
      { ...EMPTY_FILTERS, range: 'custom', from: '2026-11-01T10:00', to: '' },
      1,
      25,
      now,
    );
    expect(query.from).toBe(new Date('2026-11-01T10:00').toISOString());
    expect(query.to).toBeUndefined();
  });
});
