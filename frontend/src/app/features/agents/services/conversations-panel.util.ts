import { ConversationSummary } from '../models/conversation.model';

export type PanelState = 'collapsed' | 'expanded';

/** The stored state; absent or unknown is collapsed (first visit). */
export function panelStateOf(stored: string | null): PanelState {
  return stored === 'expanded' ? 'expanded' : 'collapsed';
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `Today`, `Yesterday`, else `MMM d`. */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Consecutive conversations of the same day, in the order given (newest first). */
export function groupConversations(
  list: ConversationSummary[],
  now: Date,
): { label: string; items: ConversationSummary[] }[] {
  const groups: { label: string; items: ConversationSummary[] }[] = [];
  for (const item of list) {
    const label = dayLabel(item.lastActivityAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** `now`, `3 min ago`, `3 h ago`, `3 d ago`. */
export function relativeTime(iso: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
