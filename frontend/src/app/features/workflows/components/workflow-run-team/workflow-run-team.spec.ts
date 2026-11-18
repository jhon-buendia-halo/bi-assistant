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
    activity: [],
    ...extra,
  };
}

describe('WorkflowRunTeam (ui.md 4.4b, Agents at work)', () => {
  let fixture: ComponentFixture<WorkflowRunTeam>;

  function render(
    stories: AgentStepStory[],
    inputs: { thought?: string; showWork?: boolean } = {},
  ): HTMLElement {
    fixture = TestBed.createComponent(WorkflowRunTeam);
    fixture.componentRef.setInput(
      'stories',
      new Map(stories.map((s) => [s.stepId, s])),
    );
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
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
    ]);
    expect(
      el.querySelector('[data-testid="workflow-run-team-handoff"]')
        ?.textContent,
    ).toContain('Olivia passed plan to Michael');
    expect(
      el.querySelector('[data-testid="workflow-run-team-analyse"]')
        ?.textContent,
    ).toContain("I'm running query 2…");
    // A waiting agent has no row of its own: it is on the Up next line.
    expect(
      el.querySelector('[data-testid="workflow-run-team-write"]'),
    ).toBeNull();
    expect(
      el
        .querySelector('[data-testid="workflow-run-team-up-next"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toMatch(/^Up next .*Jessica writes$/);
  });

  it("shows the working agent's thought and steps under it, in Builder", () => {
    const activity: AgentStepStory['activity'] = [
      {
        label: 'Read the columns of goals',
        state: 'done',
        rows: null,
        query: false,
        tool: 'describe_entity',
        detail: 'describe_entity',
      },
      {
        label: 'Teams tied at the top',
        state: 'current',
        rows: null,
        query: true,
        tool: 'run_readonly_sql',
        detail: 'run_readonly_sql',
      },
    ];
    const stories = [
      story('analyse', 'Michael', 'active', {
        activity,
        sentence: "I'm running query 1…",
      }),
    ];
    let el = render(stories, { thought: 'Brazil and Germany are close.' });
    const row = el.querySelector('[data-testid="workflow-run-team-analyse"]')!;
    expect(row.textContent).toContain('· working');
    expect(
      row.querySelector('[data-testid="workflow-run-team-thought"]')
        ?.textContent,
    ).toContain('Brazil and Germany are close.');
    expect(
      row.querySelectorAll('[data-testid="workflow-run-tool"]').length,
    ).toBe(2);
    const opened = jasmine.createSpy('openNode');
    fixture.componentInstance.openNode.subscribe(opened);
    row
      .querySelector<HTMLButtonElement>('button[data-tool="run_readonly_sql"]')!
      .click();
    expect(opened).toHaveBeenCalledWith('analyse');

    // Business: only the step under way, in words (R38).
    el = render(stories, {
      thought: 'Brazil and Germany are close.',
      showWork: false,
    });
    expect(el.querySelector('[data-testid="workflow-run-tool"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="workflow-run-team-thought"]'),
    ).toBeNull();
    expect(
      el
        .querySelector('[data-testid="workflow-run-team-now"]')
        ?.textContent?.trim(),
    ).toBe('Teams tied at the top');
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
