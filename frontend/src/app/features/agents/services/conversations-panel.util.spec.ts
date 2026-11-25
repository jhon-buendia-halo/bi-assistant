import { ConversationSummary } from '../models/conversation.model';
import {
  groupConversations,
  panelStateOf,
  relativeTime,
} from './conversations-panel.util';

function row(id: string, lastActivityAt: string): ConversationSummary {
  return {
    id,
    title: `Question ${id}`,
    datasets: ['world-cup'],
    lastActivityAt,
    runCount: 1,
    lastRunId: id,
    status: 'success',
  };
}

describe('groupConversations', () => {
  const now = new Date(2026, 10, 25, 14, 0, 0);

  it('groups by day: Today, Yesterday, then MMM d, keeping the order given', () => {
    const groups = groupConversations(
      [
        row('a', new Date(2026, 10, 25, 13, 0).toISOString()),
        row('b', new Date(2026, 10, 25, 9, 0).toISOString()),
        row('c', new Date(2026, 10, 24, 23, 0).toISOString()),
        row('d', new Date(2026, 10, 3, 10, 0).toISOString()),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Nov 3']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('is empty for no conversations', () => {
    expect(groupConversations([], now)).toEqual([]);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-11-25T14:00:00Z');
  it('says now under a minute, then minutes, hours and days', () => {
    expect(relativeTime('2026-11-25T13:59:40Z', now)).toBe('now');
    expect(relativeTime('2026-11-25T13:57:00Z', now)).toBe('3 min ago');
    expect(relativeTime('2026-11-25T11:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-22T14:00:00Z', now)).toBe('3 d ago');
  });
});

describe('panelStateOf', () => {
  it('is collapsed unless the stored value is expanded', () => {
    expect(panelStateOf(null)).toBe('collapsed');
    expect(panelStateOf('nonsense')).toBe('collapsed');
    expect(panelStateOf('collapsed')).toBe('collapsed');
    expect(panelStateOf('expanded')).toBe('expanded');
  });
});
