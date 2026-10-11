import type {
  ActivityEventDoc,
  UserDoc,
} from '../auth/entities/directory.entity';
import {
  activeWithin,
  agentNameOf,
  lastActiveAtOf,
  lastActivityOf,
  statusOf,
  weekStartOf,
  weeklyActiveUsers,
} from './admin-figures';

/** The derived admin figures of data-model 3.14.8 (admin R39, R41, R46). */

const NOW = new Date('2024-03-06T12:00:00.000Z'); // a Wednesday
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

const user = (fields: Partial<UserDoc> = {}): UserDoc => ({
  id: 'u1',
  userName: 'ada@contoso.test',
  displayName: 'Ada Lovelace',
  active: true,
  source: 'scim',
  ...fields,
});

describe('last activity (admin R39)', () => {
  it('is the later of the last active day and the last sign-in', () => {
    expect(
      lastActivityOf(
        user({ lastActiveAt: daysAgo(3), lastSignInAt: daysAgo(10) }),
      ),
    ).toBe(daysAgo(3));
    expect(
      lastActivityOf(
        user({ lastActiveAt: daysAgo(10), lastSignInAt: daysAgo(3) }),
      ),
    ).toBe(daysAgo(3));
    expect(lastActivityOf(user({ lastSignInAt: daysAgo(4) }))).toBe(daysAgo(4));
    expect(lastActivityOf(user())).toBeUndefined();
  });

  it('is null on the wire for a user who never signed in', () => {
    expect(lastActiveAtOf(user({ lastActiveAt: daysAgo(1) }))).toBeNull();
    expect(lastActiveAtOf(user({ lastSignInAt: daysAgo(2) }))).toBe(daysAgo(2));
  });
});

describe('status (admin R39)', () => {
  it.each([
    [{ active: false, lastSignInAt: daysAgo(0) }, 'deactivated'],
    [{ scimDeleted: true, lastSignInAt: daysAgo(0) }, 'deactivated'],
    [{ active: false }, 'deactivated'],
    [{}, 'not-signed-in'],
    [{ lastActiveAt: daysAgo(1) }, 'not-signed-in'],
    [{ lastSignInAt: daysAgo(90) }, 'inactive'],
    [{ lastSignInAt: daysAgo(100), lastActiveAt: daysAgo(95) }, 'inactive'],
    [{ lastSignInAt: daysAgo(89.9) }, 'active'],
    [{ lastSignInAt: daysAgo(200), lastActiveAt: daysAgo(0) }, 'active'],
  ] as [Partial<UserDoc>, string][])('%j → %s', (fields, status) => {
    expect(statusOf(user(fields), NOW)).toBe(status);
  });
});

describe('active within n days (admin R41)', () => {
  it('counts a last activity in the last 30 × 24 h, whatever the status', () => {
    expect(activeWithin(user({ lastSignInAt: daysAgo(29) }), NOW, 30)).toBe(
      true,
    );
    expect(
      activeWithin(user({ lastSignInAt: daysAgo(1), active: false }), NOW, 30),
    ).toBe(true);
    expect(activeWithin(user({ lastSignInAt: daysAgo(40) }), NOW, 30)).toBe(
      false,
    );
    expect(activeWithin(user(), NOW, 30)).toBe(false);
  });
});

describe('weekly active users (admin R46)', () => {
  it('starts a week on Monday 00:00 UTC', () => {
    expect(weekStartOf(new Date('2024-01-07T23:59:59Z'))).toBe('2024-01-01');
    expect(weekStartOf(new Date('2024-01-08T00:00:00Z'))).toBe('2024-01-08');
    expect(weekStartOf(NOW)).toBe('2024-03-04');
  });

  it('counts distinct users with a user.active event per week, the last 8 weeks, oldest first', () => {
    const event = (
      type: ActivityEventDoc['type'],
      actorId: string | undefined,
      at: string,
    ): ActivityEventDoc => ({
      id: `${type}-${actorId}-${at}`,
      type,
      at,
      actorId,
    });
    const weeks = weeklyActiveUsers(
      [
        event('user.active', 'a', daysAgo(0)),
        event('user.active', 'a', daysAgo(1)),
        event('user.active', 'b', daysAgo(2)),
        event('user.active', 'c', daysAgo(14)),
        event('user.active', 'd', daysAgo(63)),
        event('sign-in', 'e', daysAgo(0)),
        event('user.active', undefined, daysAgo(0)),
      ],
      NOW,
    );
    expect(weeks).toEqual([
      { weekStart: '2024-01-15', users: 0 },
      { weekStart: '2024-01-22', users: 0 },
      { weekStart: '2024-01-29', users: 0 },
      { weekStart: '2024-02-05', users: 0 },
      { weekStart: '2024-02-12', users: 0 },
      { weekStart: '2024-02-19', users: 1 },
      { weekStart: '2024-02-26', users: 0 },
      { weekStart: '2024-03-04', users: 2 },
    ]);
  });
});

describe('agent names', () => {
  it('is the Live name, else the draft name', () => {
    const config = (name: string) => ({
      name,
      description: '',
      instructions: '',
      datasets: [],
      starterQuestions: [],
    });
    expect(agentNameOf({ draft: config('Draft'), live: config('Live') })).toBe(
      'Live',
    );
    expect(agentNameOf({ draft: config('Draft') })).toBe('Draft');
  });
});
