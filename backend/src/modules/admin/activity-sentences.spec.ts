import type {
  ActivityEventDoc,
  ActivityEventType,
} from '../auth/entities/directory.entity';
import {
  type ActivityNames,
  activitySentence,
  recentActivity,
} from './activity-sentences';

/** Recent activity sentences (admin R47; data-model 3.14.7). */

const people: Record<string, string> = {
  admin: 'Avery Admin',
  ada: 'Ada Lovelace',
  grace: 'Grace Hopper',
};
const names: ActivityNames = {
  user: (id) => (id && people[id]) || 'a deleted user',
  group: (id) => (id === 'g1' ? 'Analysts' : 'a deleted group'),
  agent: (id, fallback) =>
    id === 'agent-1' ? 'Goal analyst' : fallback || 'a deleted agent',
  datasource: (id) => (id === 'ds-1' ? 'World Cup' : (id ?? '')),
};

let seq = 0;
const event = (
  type: ActivityEventType,
  fields: Partial<ActivityEventDoc> = {},
): ActivityEventDoc => ({
  id: `e${++seq}`,
  type,
  at: '2026-10-10T10:00:00.000Z',
  ...fields,
});

describe('activitySentence', () => {
  it.each([
    [
      event('role.assigned', {
        actorId: 'admin',
        subjectId: 'ada',
        details: { role: 'maker' },
      }),
      'Avery Admin gave Ada Lovelace the Maker role',
    ],
    [
      event('role.assigned', {
        actorId: 'admin',
        subjectId: 'ada',
        details: { role: 'data-owner', datasourceId: 'ds-1' },
      }),
      'Avery Admin gave Ada Lovelace the Data owner role on World Cup',
    ],
    [
      event('role.assigned', {
        actorId: 'admin',
        subjectId: 'ada',
        details: { role: 'data-owner', datasourceId: 'ds-gone' },
      }),
      'Avery Admin gave Ada Lovelace the Data owner role on ds-gone',
    ],
    [
      event('role.removed', {
        actorId: 'admin',
        subjectId: 'grace',
        details: { role: 'platform-admin' },
      }),
      'Avery Admin removed the Platform admin role from Grace Hopper',
    ],
    [
      event('mapping.added', {
        actorId: 'admin',
        subjectId: 'g1',
        details: { role: 'approver', mappingId: 'm1' },
      }),
      'Avery Admin mapped Analysts to Approver',
    ],
    [
      event('mapping.removed', {
        actorId: 'admin',
        subjectId: 'g-gone',
        details: { role: 'maker', mappingId: 'm1' },
      }),
      'Avery Admin removed the mapping of a deleted group to Maker',
    ],
    [
      event('agent.transferred', {
        actorId: 'admin',
        subjectId: 'agent-1',
        details: {
          agentName: 'Old name',
          fromUserId: 'ada',
          toUserId: 'grace',
        },
      }),
      'Avery Admin transferred Goal analyst from Ada Lovelace to Grace Hopper',
    ],
    [
      event('agent.transferred', {
        actorId: 'gone',
        subjectId: 'agent-gone',
        details: {
          agentName: 'Card counter',
          fromUserId: 'x',
          toUserId: 'ada',
        },
      }),
      'a deleted user transferred Card counter from a deleted user to Ada Lovelace',
    ],
    [
      event('user.deactivated', { subjectId: 'ada' }),
      'Entra ID deactivated Ada Lovelace',
    ],
    [
      event('user.reactivated', { subjectId: 'ada' }),
      'Entra ID reactivated Ada Lovelace',
    ],
  ])('%#: %s', (e, sentence) => {
    expect(activitySentence(e, names)).toBe(sentence);
  });

  it.each([
    'sign-in',
    'sign-in.refused',
    'sign-out',
    'user.active',
    'scim.request',
    'agent.turn-failed',
  ] as ActivityEventType[])('leaves out %s', (type) => {
    expect(
      activitySentence(
        event(type, { actorId: 'ada', subjectId: 'ada' }),
        names,
      ),
    ).toBeNull();
  });
});

describe('recentActivity', () => {
  it('keeps the 10 newest feed events, newest first, after leaving out the others', () => {
    const events: ActivityEventDoc[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(
        event('user.deactivated', {
          subjectId: 'ada',
          at: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
        }),
      );
    }
    // Newer than all of them, but never in the feed.
    events.push(
      event('sign-in.refused', {
        subjectId: 'ada',
        at: '2026-10-09T00:00:00.000Z',
        details: { reason: 'subject-mismatch' },
      }),
      event('agent.turn-failed', {
        actorId: 'ada',
        subjectId: 'agent-1',
        at: '2026-10-09T00:00:00.000Z',
      }),
    );
    const feed = recentActivity(events, names);
    expect(feed).toHaveLength(10);
    expect(feed[0]).toEqual({
      id: events[11].id,
      type: 'user.deactivated',
      at: events[11].at,
      text: 'Entra ID deactivated Ada Lovelace',
    });
    expect(feed.map((item) => item.at)).toEqual(
      events
        .slice(2, 12)
        .map((e) => e.at)
        .reverse(),
    );
  });
});
