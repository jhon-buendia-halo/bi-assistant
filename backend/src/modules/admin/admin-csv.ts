import type { AdminOverview } from './entities/admin-views.entity';

/**
 * The overview as a CSV file (admin R48; api.md 82): UTF-8 with a byte-order
 * mark, CRLF line ends, RFC 4180 quoting, and no cell a spreadsheet would
 * run as a formula.
 */

const BOM = '﻿';
const CRLF = '\r\n';

/**
 * Leading characters a spreadsheet reads as a formula: `=`, `+`, `-`, `@`
 * (admin R48), and tab and carriage return, which some spreadsheets strip
 * before reading the rest as one (OWASP CSV injection).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: formula-guarded with a leading `'`, then quoted if needed. */
export function csvCell(value: string | number): string {
  let cell = String(value);
  if (FORMULA_START.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  return BOM + rows.map((row) => row.map(csvCell).join(',') + CRLF).join('');
}

/** The rows of api.md 82, in order, under the `section,label,value` header. */
export function overviewCsv(overview: AdminOverview): string {
  const { attention } = overview;
  return toCsv([
    ['section', 'label', 'value'],
    ['summary', 'Active users · 30 days', overview.activeUsers30d],
    ['summary', 'Agents live', overview.agentsLive],
    [
      'attention',
      'Agents without an active owner',
      attention.ownerlessAgents.count,
    ],
    [
      'attention',
      'Agents with errors in the last 7 days',
      attention.erroredAgents.count,
    ],
    [
      'attention',
      'Users inactive for 90+ days with Maker role',
      attention.inactiveMakers.count,
    ],
    ...overview.weeklyActiveUsers.map((week) => [
      'weekly-active-users',
      week.weekStart,
      week.users,
    ]),
    ...overview.recentActivity.map((item) => ['activity', item.at, item.text]),
  ]);
}

/** `admin-report-<YYYY-MM-DD>.csv`, the UTC date of the export. */
export function overviewCsvFileName(generatedAt: string): string {
  return `admin-report-${generatedAt.slice(0, 10)}.csv`;
}
