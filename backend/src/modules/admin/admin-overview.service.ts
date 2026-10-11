import { Injectable } from '@nestjs/common';
import { ActivityService } from '../auth/activity.service';
import { recentActivity } from './activity-sentences';
import { overviewCsv, overviewCsvFileName } from './admin-csv';
import { AdminDirectoryReader } from './admin-directory.reader';
import {
  activeWithin,
  agentNameOf,
  byName,
  DAY_MS,
  isDeactivated,
  lastActiveAtOf,
  statusOf,
  weeklyActiveUsers,
} from './admin-figures';
import type { AdminOverview } from './entities/admin-views.entity';

/** Each Needs attention list carries at most this many items (api.md 81). */
const ATTENTION_ITEMS = 100;
const ACTIVE_USERS_DAYS = 30;
const ERROR_WINDOW_DAYS = 7;

/**
 * The Overview tab (admin R41-R48; api.md 81, 82): the tiles, Needs
 * attention, the weekly chart and Recent activity, derived on every call
 * from the directory, the agents of every owner and the activity events
 * (data-model 3.14.8). Agents stored without an owner (admin R33) count
 * nowhere.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly reader: AdminDirectoryReader,
    private readonly activity: ActivityService,
  ) {}

  /** 81. */
  async overview(now = new Date()): Promise<AdminOverview> {
    const snapshot = await this.reader.load(now);
    const events = await this.activity.events();
    const ref = (id: string) => ({
      id,
      displayName: snapshot.user(id)?.displayName ?? 'unknown user',
    });

    const ownerless = snapshot.agents
      .filter((agent) => {
        const owner = snapshot.user(agent.ownerId);
        return !owner || isDeactivated(owner);
      })
      .map((agent) => {
        const owner = snapshot.user(agent.ownerId);
        return {
          agentId: agent.id,
          agentName: agentNameOf(agent),
          formerOwner: owner
            ? { id: owner.id, displayName: owner.displayName }
            : null,
        };
      })
      .sort((a, b) => byName(a.agentName, b.agentName));

    // Agent errors in the last 7 × 24 h, of agents that still exist (R40, R42).
    const since = now.getTime() - ERROR_WINDOW_DAYS * DAY_MS;
    const failures = new Map<
      string,
      { errors: number; lastErrorAt: string; lastErrorMessage: string }
    >();
    for (const event of events) {
      if (event.type !== 'agent.turn-failed' || !event.subjectId) continue;
      if (Date.parse(event.at) < since || !snapshot.agent(event.subjectId)) {
        continue;
      }
      const seen = failures.get(event.subjectId);
      const message = event.details?.message;
      if (!seen || event.at > seen.lastErrorAt) {
        failures.set(event.subjectId, {
          errors: (seen?.errors ?? 0) + 1,
          lastErrorAt: event.at,
          lastErrorMessage: typeof message === 'string' ? message : '',
        });
      } else {
        seen.errors++;
      }
    }
    const errored = [...failures.entries()]
      .map(([agentId, failure]) => {
        const agent = snapshot.agent(agentId)!;
        return {
          agentId,
          agentName: agentNameOf(agent),
          owner: ref(agent.ownerId!),
          ...failure,
        };
      })
      .sort((a, b) => byName(a.agentName, b.agentName));

    const inactiveMakers = snapshot.users
      .filter(
        (user) =>
          statusOf(user, now) === 'inactive' && snapshot.holds(user, 'maker'),
      )
      .map((user) => {
        const groupIds = new Set(
          snapshot
            .heldRoles(user)
            .filter((r) => r.role === 'maker' && r.source === 'group')
            .map((r) => r.groupId),
        );
        return {
          user: { id: user.id, displayName: user.displayName },
          lastActiveAt: lastActiveAtOf(user)!,
          makerAssignmentId:
            snapshot.assignmentsOf(user.id).find((a) => a.role === 'maker')
              ?.id ?? null,
          makerGroups: snapshot
            .groupsOf(user.id)
            .filter((g) => groupIds.has(g.id))
            .map((g) => g.displayName),
        };
      })
      .sort((a, b) => byName(a.user.displayName, b.user.displayName));

    return {
      generatedAt: now.toISOString(),
      activeUsers30d: snapshot.users.filter((user) =>
        activeWithin(user, now, ACTIVE_USERS_DAYS),
      ).length,
      agentsLive: snapshot.agents.filter((agent) => !!agent.live).length,
      attention: {
        ownerlessAgents: {
          count: ownerless.length,
          items: ownerless.slice(0, ATTENTION_ITEMS),
        },
        erroredAgents: {
          count: errored.length,
          items: errored.slice(0, ATTENTION_ITEMS),
        },
        inactiveMakers: {
          count: inactiveMakers.length,
          items: inactiveMakers.slice(0, ATTENTION_ITEMS),
        },
      },
      weeklyActiveUsers: weeklyActiveUsers(events, now),
      recentActivity: recentActivity(events, snapshot.names()),
    };
  }

  /** 82: the overview at this moment, as a CSV file. Records nothing. */
  async exportCsv(
    now = new Date(),
  ): Promise<{ fileName: string; csv: string }> {
    const overview = await this.overview(now);
    return {
      fileName: overviewCsvFileName(overview.generatedAt),
      csv: overviewCsv(overview),
    };
  }
}
