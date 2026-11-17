import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowConversationNav } from './workflow-conversation-nav';

describe('WorkflowConversationNav, the conversation navigation (workflows R38)', () => {
  let fixture: ComponentFixture<WorkflowConversationNav>;
  let el: HTMLElement;
  let picked: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowConversationNav],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkflowConversationNav);
    fixture.componentRef.setInput('items', [
      { id: 'a', label: 'Which 5 teams scored the most goals?' },
      { id: 'b', label: 'And per stage?' },
      { id: 'current', label: 'Only the finals' },
    ]);
    fixture.componentRef.setInput('active', 'b');
    picked = [];
    fixture.componentInstance.pick.subscribe((id) => picked.push(id));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('draws one tick per question, the one in view brighter, hidden from assistive tech', () => {
    const nav = el.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Conversation');
    const ticks = Array.from(
      el.querySelectorAll('[data-testid="workflow-conversation-tick"]'),
    );
    expect(ticks.length).toBe(3);
    expect(ticks.every((t) => t.getAttribute('aria-hidden') === 'true')).toBe(
      true,
    );
    expect(ticks.map((t) => t.classList.contains('bg-fg-muted'))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('lists the questions as buttons, marks the one in view, and a pick scrolls to it', () => {
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="workflow-conversation-item-"]',
      ),
    );
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Which 5 teams scored the most goals?',
      'And per stage?',
      'Only the finals',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-current'))).toEqual([
      null,
      'true',
      null,
    ]);
    expect(buttons[0].title).toBe('Which 5 teams scored the most goals?');
    buttons[0].click();
    expect(picked).toEqual(['a']);
  });
});
