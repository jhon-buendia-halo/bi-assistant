import type {
  ActivityEventDoc,
  ActivityEventType,
} from '../auth/entities/directory.entity';
import { ROLE_LABELS, type RoleId } from '../auth/permissions';
import type { ActivityItem } from './entities/admin-views.entity';

/**
 * Recent activity on the Overview (admin R47; data-model 3.14.7): a short
 * feed of the admin and directory changes, each as one sentence built when
 * read, from the names current then. Not an audit log.
 */

/** The events the feed shows; sign-ins, daily activity, SCIM requests and agent errors never appear. */
export const RECENT_ACTIVITY_TYPES: ReadonlySet<ActivityEventType> = new Set([
  'role.assigned',
  'role.removed',
  'mapping.added',
  'mapping.removed',
  'agent.transferred',
  'user.deactivated',
  'user.reactivated',
]);

export const RECENT_ACTIVITY_LIMIT = 10;

/** How an id reads in a sentence; something no longer found reads as such. */
export interface ActivityNames {
  /** The display name, else "a deleted user". */
  user(id: string | undefined): string;
  /** The group name, else "a deleted group". */
  group(id: string | undefined): string;
  /** The agent's current name, else `fallback`, else "a deleted agent". */
  agent(id: string | undefined, fallback?: string): string;
  /** The datasource name, else its id. */
  datasource(id: string | undefined): string;
}

const text = (value: unknown) =>
  typeof value === 'string' ? value : undefined;

function roleLabel(details: Record<string, unknown> | undefined): string {
  const role = text(details?.role) as RoleId | undefined;
  return (role && ROLE_LABELS[role]) ?? role ?? 'unknown';
}

/** The sentence for one event, or `null` for an event the feed leaves out. */
export function activitySentence(
  event: ActivityEventDoc,
  names: ActivityNames,
): string | null {
  const details = event.details;
  const actor = () => names.user(event.actorId);
  switch (event.type) {
    case 'role.assigned': {
      const datasourceId = text(details?.datasourceId);
      const on = datasourceId ? ` on ${names.datasource(datasourceId)}` : '';
      return `${actor()} gave ${names.user(event.subjectId)} the ${roleLabel(details)} role${on}`;
    }
    case 'role.removed':
      return `${actor()} removed the ${roleLabel(details)} role from ${names.user(event.subjectId)}`;
    case 'mapping.added':
      return `${actor()} mapped ${names.group(event.subjectId)} to ${roleLabel(details)}`;
    case 'mapping.removed':
      return `${actor()} removed the mapping of ${names.group(event.subjectId)} to ${roleLabel(details)}`;
    case 'agent.transferred':
      return `${actor()} transferred ${names.agent(event.subjectId, text(details?.agentName))} from ${names.user(text(details?.fromUserId))} to ${names.user(text(details?.toUserId))}`;
    case 'user.deactivated':
      return `Entra ID deactivated ${names.user(event.subjectId)}`;
    case 'user.reactivated':
      return `Entra ID reactivated ${names.user(event.subjectId)}`;
    default:
      return null;
  }
}

/** The newest feed events as sentences, newest first. */
export function recentActivity(
  events: readonly ActivityEventDoc[],
  names: ActivityNames,
  limit = RECENT_ACTIVITY_LIMIT,
): ActivityItem[] {
  return events
    .filter((event) => RECENT_ACTIVITY_TYPES.has(event.type))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
    .map((event) => ({
      id: event.id,
      type: event.type,
      at: event.at,
      text: activitySentence(event, names) ?? '',
    }));
}
