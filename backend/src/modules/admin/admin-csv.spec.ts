import { csvCell, overviewCsv, overviewCsvFileName } from './admin-csv';
import type { AdminOverview } from './entities/admin-views.entity';

/** The overview export (admin R48; api.md 82). */

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    [3, '3'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', `"'\rcmd"`],
    ['a=b', 'a=b'],
    ['Active users · 30 days', 'Active users · 30 days'],
  ] as [string | number, string][])('%j → %j', (value, cell) => {
    expect(csvCell(value)).toBe(cell);
  });
});

describe('overviewCsv', () => {
  const overview: AdminOverview = {
    generatedAt: '2026-10-10T08:30:00.000Z',
    activeUsers30d: 3,
    agentsLive: 1,
    attention: {
      ownerlessAgents: { count: 2, items: [] },
      erroredAgents: { count: 1, items: [] },
      inactiveMakers: { count: 0, items: [] },
    },
    weeklyActiveUsers: [
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ].map((weekStart, i) => ({ weekStart, users: i })),
    recentActivity: [
      {
        id: 'e2',
        type: 'role.assigned',
        at: '2026-10-10T08:00:00.000Z',
        text: '=Mallory gave Ada Lovelace, PhD the Maker role',
      },
      {
        id: 'e1',
        type: 'user.deactivated',
        at: '2026-10-09T08:00:00.000Z',
        text: 'Entra ID deactivated Alan Turing',
      },
    ],
  };

  it('writes a UTF-8 BOM, CRLF lines and the rows in order', () => {
    const csv = overviewCsv(overview);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines.pop()).toBe('');
    expect(lines.slice(0, 6)).toEqual([
      'section,label,value',
      'summary,Active users · 30 days,3',
      'summary,Agents live,1',
      'attention,Agents without an active owner,2',
      'attention,Agents with errors in the last 7 days,1',
      'attention,Users inactive for 90+ days with Maker role,0',
    ]);
    const weekly = lines.filter((l) => l.startsWith('weekly-active-users,'));
    expect(weekly).toHaveLength(8);
    expect(weekly[0]).toBe(
      `weekly-active-users,${overview.weeklyActiveUsers[0].weekStart},0`,
    );
    expect(lines.slice(-2)).toEqual([
      `activity,2026-10-10T08:00:00.000Z,"'=Mallory gave Ada Lovelace, PhD the Maker role"`,
      'activity,2026-10-09T08:00:00.000Z,Entra ID deactivated Alan Turing',
    ]);
    expect(lines).toHaveLength(1 + 2 + 3 + 8 + 2);
  });

  it('names the file after the UTC date', () => {
    expect(overviewCsvFileName('2026-10-10T23:59:59.000Z')).toBe(
      'admin-report-2026-10-10.csv',
    );
  });
});
