import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityStep } from '../../services/agent-activity';
import { AgentActivity } from './agent-activity';

function step(label: string, extra: Partial<ActivityStep> = {}): ActivityStep {
  return {
    label,
    state: 'done',
    rows: null,
    query: false,
    tool: 'describe_entity',
    detail: 'describe_entity',
    ...extra,
  };
}

describe('AgentActivity (ui.md 4.4b, Agents at work)', () => {
  let fixture: ComponentFixture<AgentActivity>;

  function render(steps: ActivityStep[], live = true): HTMLElement {
    fixture = TestBed.createComponent(AgentActivity);
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('live', live);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const lines = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-testid="workflow-run-tool"]')].map((l) =>
      [...l.querySelectorAll('span')]
        .map((span) => span.textContent?.trim())
        .join(' '),
    );
  const toggle = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>(
      '[data-testid="agent-activity-toggle"]',
    );

  it('shows nothing without steps', () => {
    expect(
      render([]).querySelector('[data-testid="agent-activity"]'),
    ).toBeNull();
  });

  it('shows every step while there are few, each in words with its rows', () => {
    const el = render([
      step('Read the columns of goals'),
      step('Goals per team', {
        query: true,
        rows: '66 rows',
        tool: 'run_readonly_sql',
      }),
      step('Teams tied at the top', { state: 'current', query: true }),
    ]);
    expect(toggle(el)).toBeNull();
    expect(lines(el)).toEqual([
      'Read the columns of goals',
      'Goals per team 66 rows Open',
      'Teams tied at the top Open',
    ]);
    const states = [
      ...el.querySelectorAll('[data-testid="workflow-run-tool"]'),
    ].map((l) => l.getAttribute('data-state'));
    expect(states).toEqual(['done', 'done', 'current']);
  });

  it('folds the earlier steps while the agent works, and unfolds them on demand', () => {
    const el = render(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((label) => step(label)),
    );
    expect(lines(el)).toEqual(['d', 'e', 'f']);
    expect(toggle(el)?.textContent?.trim()).toBe('Show 3 earlier steps');
    expect(toggle(el)?.getAttribute('aria-expanded')).toBe('false');
    toggle(el)!.click();
    fixture.detectChanges();
    expect(lines(el)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(toggle(el)?.textContent?.trim()).toBe('Hide earlier steps');
  });

  it('folds every step once the agent ended', () => {
    const el = render([step('a'), step('b')], false);
    expect(lines(el)).toEqual([]);
    expect(toggle(el)?.textContent?.trim()).toBe('Show 2 steps');
    toggle(el)!.click();
    fixture.detectChanges();
    expect(lines(el)).toEqual(['a', 'b']);
  });

  it("opens the step's queries from a query's line only", () => {
    const el = render([
      step('Read the columns'),
      step('Goals per team', { query: true, tool: 'run_readonly_sql' }),
    ]);
    const opened = jasmine.createSpy('openQuery');
    fixture.componentInstance.openQuery.subscribe(opened);
    const [lookup, query] = [
      ...el.querySelectorAll<HTMLElement>('[data-testid="workflow-run-tool"]'),
    ];
    expect(lookup.tagName).toBe('DIV');
    expect(query.tagName).toBe('BUTTON');
    expect(query.getAttribute('data-tool')).toBe('run_readonly_sql');
    query.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
