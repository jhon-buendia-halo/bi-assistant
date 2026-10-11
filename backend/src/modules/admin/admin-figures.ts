import type {
  ActivityEventDoc,
  AssignableRoleId,
  UserDoc,
} from '../auth/entities/directory.entity';
import type { UserAgentDoc } from '../user-agents/entities/user-agent.entity';
import type {
  UserStatus,
  WeeklyActiveUsers,
} from './entities/admin-views.entity';

/**
 * The derived admin figures (data-model 3.14.8; admin R39, R41, R46). Pure
 * functions of the stored documents and the time; nothing here is stored.
 */

export const DAY_MS = 86_400_000;

/** A user is Inactive after this many days without activity (admin R39). */
export const INACTIVE_AFTER_DAYS = 90;

/** Weeks in the Weekly active users chart (admin R46). */
export const CHART_WEEKS = 8;

/** Role badges, in the order the users table shows them (admin R52). */
export const ROLE_BADGE_ORDER: readonly AssignableRoleId[] = [
  'platform-admin',
  'approver',
  'data-owner',
  'maker',
];

type Activity = Pick<UserDoc, 'lastActiveAt' | 'lastSignInAt'>;

/**
 * Last activity: `lastActiveAt` (the first request of the user's latest
 * active UTC day), or `lastSignInAt` when later or the other is absent.
 */
export function lastActivityOf(user: Activity): string | undefined {
  const { lastActiveAt, lastSignInAt } = user;
  if (!lastActiveAt) return lastSignInAt;
  if (!lastSignInAt) return lastActiveAt;
  return lastSignInAt > lastActiveAt ? lastSignInAt : lastActiveAt;
}

/** Last active on the wire (api.md 83): `null` for a user who never signed in. */
export function lastActiveAtOf(user: Activity): string | null {
  return user.lastSignInAt ? (lastActivityOf(user) ?? null) : null;
}

/** Deactivated through SCIM, removed through SCIM, or released (admin R16). */
export function isDeactivated(user: Pick<UserDoc, 'active' | 'scimDeleted'>) {
  return !user.active || user.scimDeleted === true;
}

/** Admin R39: the first of Deactivated, Not signed in, Inactive, Active. */
export function statusOf(user: UserDoc, now: Date): UserStatus {
  if (isDeactivated(user)) return 'deactivated';
  if (!user.lastSignInAt) return 'not-signed-in';
  const last = Date.parse(lastActivityOf(user)!);
  return now.getTime() - last >= INACTIVE_AFTER_DAYS * DAY_MS
    ? 'inactive'
    : 'active';
}

/** Last activity within the last `days` × 24 hours, whatever the status. */
export function activeWithin(user: Activity, now: Date, days: number): boolean {
  const last = lastActivityOf(user);
  return !!last && now.getTime() - Date.parse(last) <= days * DAY_MS;
}

/** The Monday (UTC) of the week holding `at`, as `YYYY-MM-DD`. */
export function weekStartOf(at: Date): string {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  return new Date(day - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Distinct users with a `user.active` event in each of the last `weeks`
 * UTC weeks (Monday to Sunday), oldest first; the current week is last.
 */
export function weeklyActiveUsers(
  events: readonly ActivityEventDoc[],
  now: Date,
  weeks = CHART_WEEKS,
): WeeklyActiveUsers[] {
  const current = Date.parse(`${weekStartOf(now)}T00:00:00.000Z`);
  const starts = Array.from(
    { length: weeks },
    (_, i) => current - (weeks - 1 - i) * 7 * DAY_MS,
  );
  const users = starts.map(() => new Set<string>());
  const end = current + 7 * DAY_MS;
  for (const event of events) {
    if (event.type !== 'user.active' || !event.actorId) continue;
    const at = Date.parse(event.at);
    if (!(at >= starts[0] && at < end)) continue;
    users[Math.floor((at - starts[0]) / (7 * DAY_MS))].add(event.actorId);
  }
  return starts.map((start, i) => ({
    weekStart: new Date(start).toISOString().slice(0, 10),
    users: users[i].size,
  }));
}

/** An agent's name: its Live name, else its draft name (api.md 81). */
export function agentNameOf(doc: Pick<UserAgentDoc, 'draft' | 'live'>): string {
  return doc.live?.name ?? doc.draft?.name ?? '';
}

/** Case-insensitive name order, for every admin list. */
export function byName(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `1 agent`, `2 agents` (admin R42, R64). */
export function countOf(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
