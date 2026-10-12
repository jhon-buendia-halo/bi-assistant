import { AdminHeldRole } from '../models/admin.models';
import { userDetail } from '../testing/admin.fixtures';
import {
  BOOTSTRAP_REASON,
  LOCAL_BOOTSTRAP_REASON,
  OWN_ADMIN_REASON,
  desiredGrants,
  initialTicks,
  roleRows,
  saveBlocker,
  storedGrants,
} from './user-roles';

const held = (...roles: AdminHeldRole[]) =>
  userDetail({ heldRoles: [{ role: 'user', source: 'implicit' }, ...roles] });

describe('user-roles', () => {
  it('lists Platform admin, Approver, Maker, then each owned datasource (admin R59)', () => {
    const rows = roleRows(
      held(
        { role: 'maker', source: 'direct', assignmentId: 'ra1' },
        { role: 'data-owner', source: 'direct', assignmentId: 'ra2', datasourceId: 'ds2', datasourceName: 'Warehouse' },
        { role: 'data-owner', source: 'direct', assignmentId: 'ra3', datasourceId: 'ds1', datasourceName: 'Policies volume' },
      ),
    );
    expect(rows.map((r) => [r.label, r.description, r.direct, r.locked])).toEqual([
      ['Platform admin', 'Manage users, roles, policies and settings', false, false],
      ['Approver', 'Approve org-wide publishing', false, false],
      ['Maker', 'Create, test and share agents with their team', true, false],
      ['Data owner · Policies volume', 'Approves access requests to this data source', true, false],
      ['Data owner · Warehouse', 'Approves access requests to this data source', true, false],
    ]);
    expect([...initialTicks(rows)]).toEqual(['maker', 'data-owner:ds1', 'data-owner:ds2']);
  });

  it('locks a role held from groups, naming them (admin R60)', () => {
    const rows = roleRows(
      held(
        { role: 'approver', source: 'group', groupId: 'g2', groupNames: ['Reviewers'] },
        { role: 'approver', source: 'group', groupId: 'g1', groupNames: ['Analysts'] },
        { role: 'approver', source: 'direct', assignmentId: 'ra1' },
        { role: 'data-owner', source: 'group', groupId: 'g1', groupNames: ['Analysts'], datasourceId: 'ds1', datasourceName: 'World Cup' },
      ),
    );
    const approver = rows.find((r) => r.role === 'approver')!;
    expect([approver.locked, approver.reason, approver.direct]).toEqual([
      true,
      'From group Analysts, Reviewers',
      true,
    ]);
    const owner = rows.find((r) => r.key === 'data-owner:ds1')!;
    expect([owner.label, owner.locked, owner.reason]).toEqual([
      'Data owner · World Cup',
      true,
      'From group Analysts',
    ]);
    expect(initialTicks(rows).has('approver')).toBeTrue();
    // The direct assignment behind a locked row stays as it is.
    expect(desiredGrants(rows, new Set(), null)).toEqual([{ role: 'approver' }]);
  });

  it('locks a bootstrap admin and your own direct Platform admin (admin R60, R61)', () => {
    const bootstrap = roleRows(
      userDetail({
        heldRoles: [{ role: 'platform-admin', source: 'bootstrap' }],
        isBootstrap: true,
        isSelf: true,
      }),
    );
    expect(bootstrap[0].reason).toBe(BOOTSTRAP_REASON);

    // In local mode the bootstrap admin is Demo User (admin R69, R74).
    const demo = roleRows(
      userDetail({
        heldRoles: [{ role: 'platform-admin', source: 'bootstrap' }],
        isBootstrap: true,
        isSelf: true,
      }),
      true,
    );
    expect([demo[0].locked, demo[0].reason]).toEqual([true, LOCAL_BOOTSTRAP_REASON]);

    const self = roleRows(
      userDetail({
        heldRoles: [{ role: 'platform-admin', source: 'direct', assignmentId: 'ra1' }],
        isSelf: true,
      }),
    );
    expect([self[0].locked, self[0].reason]).toEqual([true, OWN_ADMIN_REASON]);

    const other = roleRows(
      userDetail({
        heldRoles: [{ role: 'platform-admin', source: 'direct', assignmentId: 'ra1' }],
        isSelf: false,
      }),
    );
    expect(other[0].locked).toBeFalse();
  });

  it('shows a Data owner role whose datasource was deleted, ticked and removable', () => {
    const rows = roleRows(
      held(
        {
          role: 'data-owner',
          source: 'direct',
          assignmentId: 'ra2',
          datasourceId: 'ds-gone',
          datasourceName: 'ds-gone',
          datasourceMissing: true,
        },
        { role: 'data-owner', source: 'direct', assignmentId: 'ra3', datasourceId: 'ds1', datasourceName: 'World Cup' },
      ),
    );
    const removed = rows.find((r) => r.key === 'data-owner:ds-gone')!;
    expect([removed.label, removed.description, removed.locked]).toEqual([
      'Data owner · datasource removed',
      'Its datasource no longer exists, so this role grants nothing. Untick it to remove it.',
      false,
    ]);
    const ticks = initialTicks(rows);
    expect(ticks.has('data-owner:ds-gone')).toBeTrue();
    // Unticking it and saving leaves it out of the direct roles (api 85).
    ticks.delete('data-owner:ds-gone');
    expect(saveBlocker(rows, ticks, false, '')).toBeNull();
    expect(desiredGrants(rows, ticks, null)).toEqual([
      { role: 'data-owner', datasourceId: 'ds1' },
    ]);
  });

  it('sends every ticked role and a new datasource, and only when changed (admin R62)', () => {
    const rows = roleRows(held({ role: 'maker', source: 'direct', assignmentId: 'ra1' }));
    const ticks = initialTicks(rows);
    expect(storedGrants(rows)).toEqual([{ role: 'maker' }]);
    expect(saveBlocker(rows, ticks, false, '')).toBe('No changes to save');

    // Data owner ticked without a datasource.
    expect(saveBlocker(rows, ticks, true, '')).toBe('Choose a datasource for Data owner');
    expect(saveBlocker(rows, ticks, true, 'ds1')).toBeNull();
    expect(desiredGrants(rows, ticks, 'ds1')).toEqual([
      { role: 'maker' },
      { role: 'data-owner', datasourceId: 'ds1' },
    ]);

    // Tick Approver, untick Maker.
    const changed = new Set(['approver']);
    expect(saveBlocker(rows, changed, false, '')).toBeNull();
    expect(desiredGrants(rows, changed, null)).toEqual([{ role: 'approver' }]);

    // Ticking back to what is stored is no change.
    expect(saveBlocker(rows, new Set(['maker']), false, '')).toBe('No changes to save');
  });
});
