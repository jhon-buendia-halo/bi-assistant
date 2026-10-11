import { HttpErrorResponse } from '@angular/common/http';
import { WeeklyActiveUsers } from '../models/admin.models';

/** Times, counts and captions of the Admin area (ui.md 4.18.1, admin R39, R46). */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Midnight UTC of the day `ms` falls on. */
const utcDay = (ms: number): number => Math.floor(ms / DAY_MS);

/** `1 agent` / `2 agents`: a count with its noun, singular for one. */
export function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** Thousands separators (`1,940`). */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * **Last active** at day precision, by UTC calendar day (admin R39):
 * `Today`, `Yesterday`, `<n> days ago`, or `Never`.
 */
export function lastActiveLabel(
  lastActiveAt: string | null,
  now: number = Date.now(),
): string {
  if (!lastActiveAt) return 'Never';
  const days = utcDay(now) - utcDay(Date.parse(lastActiveAt));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${formatCount(days)} days ago`;
}

/**
 * A relative time (last sync, recent activity, last error): `just now`,
 * `<n> minute(s) ago`, `<n> hour(s) ago`, `yesterday`, `<n> days ago`.
 */
export function relativeTime(at: string, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(at));
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${plural(Math.floor(elapsed / MINUTE_MS), 'minute')} ago`;
  if (elapsed < DAY_MS) return `${plural(Math.floor(elapsed / HOUR_MS), 'hour')} ago`;
  const days = Math.floor(elapsed / DAY_MS);
  return days === 1 ? 'yesterday' : `${formatCount(days)} days ago`;
}

/** The full local date and time, for a relative time's `title`. */
export function fullTime(at: string): string {
  return new Date(at).toLocaleString();
}

/** `Mon D` of a week's Monday (`2026-10-05` → `Oct 5`). */
export function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The Weekly active users caption (admin R46). The peak is the highest
 * count; when several weeks share it, the latest one is named.
 */
export function weeklyCaption(weeks: readonly WeeklyActiveUsers[]): string {
  const peak = Math.max(0, ...weeks.map((week) => week.users));
  if (peak === 0) return 'Last 8 weeks · no activity yet';
  const last = weeks.length - 1;
  if (weeks[last].users === peak) {
    return `Last 8 weeks · peak ${formatCount(peak)} this week`;
  }
  const week = [...weeks].reverse().find((w) => w.users === peak)!;
  return `Last 8 weeks · peak ${formatCount(peak)} in the week of ${weekLabel(week.weekStart)}`;
}

/** Bar heights in px for the chart's 120 px box; an empty week is a 2 px stub. */
export function barHeights(
  weeks: readonly WeeklyActiveUsers[],
  box = 120,
): number[] {
  const peak = Math.max(0, ...weeks.map((week) => week.users));
  return weeks.map((week) =>
    week.users === 0 || peak === 0
      ? 2
      : Math.max(2, Math.round((week.users / peak) * box)),
  );
}

/** The table range `<first>–<last> of <total>` (admin R53). */
export function pageRange(page: number, pageSize: number, total: number): string {
  if (total === 0) return '0 of 0';
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return `${formatCount(first)}–${formatCount(last)} of ${formatCount(total)}`;
}

/** The file name of a `Content-Disposition: attachment; filename="…"` header. */
export function attachmentName(disposition: string | null): string | null {
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1].trim()) : null;
}

/** `admin-report-<YYYY-MM-DD>.csv` for today's UTC date (admin R48). */
export function defaultReportName(now: number = Date.now()): string {
  return `admin-report-${new Date(now).toISOString().slice(0, 10)}.csv`;
}

/** The message to show for a failed admin call (ui.md 5.3). */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: unknown } | null;
    const message = body && typeof body === 'object' ? body.message : null;
    if (typeof message === 'string' && message) return message;
    if (Array.isArray(message) && message.length) return message.join('. ');
  }
  return 'Backend unreachable';
}
