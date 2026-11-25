import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  CONVERSATIONS_PANEL_KEY,
  ConversationSummary,
} from '../../models/conversation.model';
import { ConversationsApiService } from '../../services/conversations-api.service';
import { AgentConversationsPanel } from './agent-conversations-panel';

function row(
  id: string,
  at: Date,
  title = `Question ${id}`,
): ConversationSummary {
  return {
    id,
    title,
    datasets: ['world-cup'],
    lastActivityAt: at.toISOString(),
    runCount: 1,
    lastRunId: id,
    status: 'success',
  };
}

describe('AgentConversationsPanel', () => {
  let list: jasmine.Spy;
  let fixture: ComponentFixture<AgentConversationsPanel>;

  const el = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const all = (id: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`));

  function create(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(AgentConversationsPanel);
    fixture.componentRef.setInput('workflowId', 'agent:insights-lead');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.removeItem(CONVERSATIONS_PANEL_KEY);
    const now = new Date();
    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      12,
    );
    list = jasmine.createSpy('list').and.callFake(() =>
      of({
        conversations: [
          row('a', now, 'Top scorers'),
          row('b', now, 'Goals by year'),
          row('c', yesterday, 'Cards'),
        ],
      }),
    );
    TestBed.configureTestingModule({
      providers: [{ provide: ConversationsApiService, useValue: { list } }],
    });
  });

  afterEach(() => localStorage.removeItem(CONVERSATIONS_PANEL_KEY));

  it('is collapsed by default, with the count on the toggle and the history icon', () => {
    create();
    expect(el('conversations-panel')?.getAttribute('data-state')).toBe(
      'collapsed',
    );
    const toggle = el('conversations-panel-toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe('Show conversations · 3');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el('conversations-panel-history')?.getAttribute('aria-label')).toBe(
      'Conversations · 3',
    );
    expect(el('conversations-panel-count')?.textContent?.trim()).toBe('3');
    expect(el('conversations-panel-new')?.getAttribute('aria-label')).toBe(
      'New conversation',
    );
    expect(el('conversations-panel-archived')?.getAttribute('aria-label')).toBe(
      'Archived conversations',
    );
  });

  it('expands, writes the state, and a new panel reads it back', () => {
    create();
    el('conversations-panel-toggle')!.click();
    fixture.detectChanges();
    expect(el('conversations-panel')?.getAttribute('data-state')).toBe(
      'expanded',
    );
    expect(localStorage.getItem(CONVERSATIONS_PANEL_KEY)).toBe('expanded');
    expect(el('conversations-panel-toggle')?.getAttribute('aria-label')).toBe(
      'Hide conversations',
    );
    fixture.destroy();

    create();
    expect(el('conversations-panel')?.getAttribute('data-state')).toBe(
      'expanded',
    );

    el('conversations-panel-toggle')!.click();
    fixture.detectChanges();
    expect(localStorage.getItem(CONVERSATIONS_PANEL_KEY)).toBe('collapsed');
  });

  it('groups the list by day and marks the current conversation', () => {
    localStorage.setItem(CONVERSATIONS_PANEL_KEY, 'expanded');
    create({ currentId: 'b' });
    expect(el('conversations-panel-title')?.textContent?.trim()).toBe(
      'Conversations with Elena',
    );
    const groups = all('conversations-panel-group');
    expect(
      groups.map((g) => g.querySelector('h3')?.textContent?.trim()),
    ).toEqual(['Today', 'Yesterday']);
    const items = all('conversation-item');
    expect(items.length).toBe(3);
    expect(items.map((i) => i.getAttribute('aria-current'))).toEqual([
      null,
      'true',
      null,
    ]);
    expect(items[0].textContent).toContain('world-cup · now');
  });

  it('is pushed aside without saving when the dashboard opens', () => {
    localStorage.setItem(CONVERSATIONS_PANEL_KEY, 'expanded');
    create({ pushedAside: true });
    expect(el('conversations-panel')?.getAttribute('data-state')).toBe(
      'collapsed',
    );
    expect(localStorage.getItem(CONVERSATIONS_PANEL_KEY)).toBe('expanded');
    fixture.componentRef.setInput('pushedAside', false);
    fixture.detectChanges();
    expect(el('conversations-panel')?.getAttribute('data-state')).toBe(
      'expanded',
    );
  });

  it('Archived switches to the archived list and Back returns', () => {
    create();
    el('conversations-panel-archived')!.click();
    fixture.detectChanges();
    expect(list).toHaveBeenCalledWith({
      workflowId: 'agent:insights-lead',
      archived: true,
      q: '',
    });
    expect(el('conversations-panel-title')?.textContent?.trim()).toBe(
      'Archived conversations',
    );
    el('conversations-panel-back')!.click();
    fixture.detectChanges();
    expect(el('conversations-panel-title')?.textContent?.trim()).toBe(
      'Conversations with Elena',
    );
  });

  it('searches after 250 ms and shows the empty copy', () => {
    jasmine.clock().install();
    try {
      localStorage.setItem(CONVERSATIONS_PANEL_KEY, 'expanded');
      create();
      list.calls.reset();
      list.and.returnValue(of({ conversations: [] }));
      const input = el('conversations-panel-search') as HTMLInputElement;
      input.value = 'xyz';
      input.dispatchEvent(new Event('input'));
      jasmine.clock().tick(100);
      fixture.detectChanges();
      expect(list).not.toHaveBeenCalled();
      jasmine.clock().tick(200);
      fixture.detectChanges();
      expect(list).toHaveBeenCalledWith({
        workflowId: 'agent:insights-lead',
        archived: false,
        q: 'xyz',
      });
      expect(el('conversations-panel-empty')?.textContent?.trim()).toBe(
        'No conversations match "xyz".',
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('emits the picked conversation and New conversation', () => {
    localStorage.setItem(CONVERSATIONS_PANEL_KEY, 'expanded');
    create();
    const opened: ConversationSummary[] = [];
    let created = 0;
    fixture.componentInstance.open.subscribe((c) => opened.push(c));
    fixture.componentInstance.newConversation.subscribe(() => created++);
    all('conversation-item')[1].click();
    el('conversations-panel-new')!.click();
    expect(opened.map((c) => c.id)).toEqual(['b']);
    expect(created).toBe(1);
  });
});
