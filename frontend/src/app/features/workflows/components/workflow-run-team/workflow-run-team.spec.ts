import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AgentStepStory } from '../../services/agent-step-story';
import { WorkflowRunTeam } from './workflow-run-team';

function story(
  stepId: string,
  name: string,
  state: AgentStepStory['state'],
  extra: Partial<AgentStepStory> = {},
): AgentStepStory {
  return {
    stepId,
    title: stepId,
    agent: { key: `k-${stepId}`, name, role: '' },
    state,
    line: '',
    doing: '',
    sentence: null,
    durationMs: null,
    queries: 0,
    passes: [],
    ...extra,
  };
}

describe('WorkflowRunTeam (ui.md 4.4b, Agents at work)', () => {
  let fixture: ComponentFixture<WorkflowRunTeam>;

  function render(stories: AgentStepStory[]): HTMLElement {
    fixture = TestBed.createComponent(WorkflowRunTeam);
    fixture.componentRef.setInput(
      'stories',
      new Map(stories.map((s) => [s.stepId, s])),
    );
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows nothing before a run', () => {
    const el = render([story('plan', 'Olivia', 'idle')]);
    expect(el.querySelector('[data-testid="workflow-run-team"]')).toBeNull();
  });

  it('lists each agent with its sentence, and the handoff between them', () => {
    const el = render([
      story('plan', 'Olivia', 'done', {
        sentence: "I'll work out goals from goals.",
        passes: ['plan'],
        durationMs: 1200,
        line: 'Done · 1.2 s',
      }),
      story('analyse', 'Michael', 'active', {
        sentence: "I'm running query 2…",
        queries: 2,
      }),
      story('write', 'Jessica', 'waiting', { line: 'Waiting for Michael' }),
    ]);
    const rows = [
      ...el.querySelectorAll('[data-testid^="workflow-run-team-"][data-state]'),
    ];
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual([
      'done',
      'active',
      'waiting',
    ]);
    expect(
      el.querySelector('[data-testid="workflow-run-team-handoff"]')
        ?.textContent,
    ).toContain('Olivia passed plan to Michael');
    expect(
      el.querySelector('[data-testid="workflow-run-team-analyse"]')
        ?.textContent,
    ).toContain("I'm running query 2…");
    expect(
      el.querySelector('[data-testid="workflow-run-team-write"]')?.textContent,
    ).toContain('Waiting for Michael');
    // A waiting agent has nothing to open yet.
    expect(
      el.querySelector('[data-testid="workflow-run-team-open-write"]'),
    ).toBeNull();
  });

  it("opens an agent's node from its row", () => {
    const el = render([story('analyse', 'Michael', 'done', { queries: 3 })]);
    const opened = jasmine.createSpy('openNode');
    fixture.componentInstance.openNode.subscribe(opened);
    const button = el.querySelector<HTMLButtonElement>(
      '[data-testid="workflow-run-team-open-analyse"]',
    )!;
    expect(button.textContent?.trim()).toBe('See 3 queries and data');
    button.click();
    expect(opened).toHaveBeenCalledWith('analyse');
  });
});
