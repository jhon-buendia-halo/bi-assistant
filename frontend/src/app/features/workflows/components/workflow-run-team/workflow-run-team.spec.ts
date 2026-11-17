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
    concern: false,
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

  it('names each agent persona with its role, and none when it has no role (R39)', () => {
    const el = render([
      story('write', 'Jessica', 'done', {
        agent: {
          key: 'answer-writer',
          name: 'Jessica',
          role: 'Insights Writer',
        },
        line: 'Done · 5.8 s',
        durationMs: 5800,
      }),
      story('plan', 'Olivia', 'done', {
        line: 'Done · 1.2 s',
        durationMs: 1200,
      }),
    ]);
    const write = el.querySelector('[data-testid="workflow-run-team-write"]')!;
    expect(
      write
        .querySelector('[data-testid="workflow-run-team-role"]')
        ?.textContent?.trim(),
    ).toBe('· Insights Writer');
    // Name, role, step and duration, in that order.
    expect(write.textContent).toMatch(
      /Jessica\s*·\s*Insights Writer\s*·\s*write\s*·\s*5\.8 s/,
    );
    const plan = el.querySelector('[data-testid="workflow-run-team-plan"]')!;
    expect(
      plan.querySelector('[data-testid="workflow-run-team-role"]'),
    ).toBeNull();
  });

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
