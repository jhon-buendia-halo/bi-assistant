import { HttpErrorResponse } from '@angular/common/http';
import {
  attachmentName,
  barHeights,
  defaultReportName,
  errorMessage,
  formatCount,
  lastActiveLabel,
  pageRange,
  plural,
  relativeTime,
  weekLabel,
  weeklyCaption,
} from './admin-format';

const NOW = Date.parse('2026-10-10T15:00:00Z');
const weeks = (users: number[]) =>
  users.map((n, i) => ({
    weekStart: new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10),
    users: n,
  }));

describe('admin-format', () => {
  it('pluralises counts with thousands separators', () => {
    expect(plural(1, 'agent')).toBe('1 agent');
    expect(plural(0, 'agent')).toBe('0 agents');
    expect(plural(2, 'user')).toBe('2 users');
    expect(formatCount(1940)).toBe('1,940');
  });

  it('reads last activity by UTC calendar day (admin R39)', () => {
    expect(lastActiveLabel(null, NOW)).toBe('Never');
    expect(lastActiveLabel('2026-10-10T00:01:00Z', NOW)).toBe('Today');
    expect(lastActiveLabel('2026-10-09T23:59:00Z', NOW)).toBe('Yesterday');
    expect(lastActiveLabel('2026-07-07T12:00:00Z', NOW)).toBe('95 days ago');
  });

  it('reads relative times from just now to days (ui.md 4.18.1)', () => {
    const ago = (ms: number) => new Date(NOW - ms).toISOString();
    expect(relativeTime(ago(30_000), NOW)).toBe('just now');
    expect(relativeTime(ago(60_000), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(relativeTime(ago(3_600_000), NOW)).toBe('1 hour ago');
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe('2 hours ago');
    expect(relativeTime(ago(30 * 3_600_000), NOW)).toBe('yesterday');
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe('3 days ago');
  });

  it('names a week by its Monday', () => {
    expect(weekLabel('2026-10-05')).toBe('Oct 5');
  });

  it('captions the weekly chart (admin R46)', () => {
    expect(weeklyCaption(weeks([0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'Last 8 weeks · no activity yet',
    );
    expect(weeklyCaption(weeks([1, 2, 1, 0, 0, 1, 2, 3]))).toBe(
      'Last 8 weeks · peak 3 this week',
    );
    // A tie with the current week counts as this week.
    expect(weeklyCaption(weeks([3, 0, 0, 0, 0, 0, 0, 3]))).toBe(
      'Last 8 weeks · peak 3 this week',
    );
    // Otherwise the latest week with the peak is named.
    expect(weeklyCaption(weeks([1940, 2, 1940, 0, 0, 0, 0, 1]))).toBe(
      'Last 8 weeks · peak 1,940 in the week of Aug 31',
    );
  });

  it('scales the bars to the peak, with a 2 px stub for an empty week', () => {
    expect(barHeights(weeks([0, 1, 2, 4]))).toEqual([2, 30, 60, 120]);
    expect(barHeights(weeks([0, 0]))).toEqual([2, 2]);
  });

  it('formats the table range (admin R53)', () => {
    expect(pageRange(1, 25, 34)).toBe('1–25 of 34');
    expect(pageRange(2, 25, 34)).toBe('26–34 of 34');
    expect(pageRange(1, 25, 0)).toBe('0 of 0');
  });

  it('reads the export file name from Content-Disposition (admin R48)', () => {
    expect(
      attachmentName('attachment; filename="admin-report-2026-10-10.csv"'),
    ).toBe('admin-report-2026-10-10.csv');
    expect(attachmentName(null)).toBeNull();
    expect(defaultReportName(NOW)).toBe('admin-report-2026-10-10.csv');
  });

  it("shows the server's message, else Backend unreachable", () => {
    const error = (body: unknown, status = 400) =>
      new HttpErrorResponse({ error: body, status });
    expect(errorMessage(error({ message: 'Agent x not found' }, 404))).toBe(
      'Agent x not found',
    );
    expect(errorMessage(error({ message: ['a', 'b'] }))).toBe('a. b');
    expect(errorMessage(error(null, 0))).toBe('Backend unreachable');
    expect(errorMessage(new Error('boom'))).toBe('Backend unreachable');
  });
});
