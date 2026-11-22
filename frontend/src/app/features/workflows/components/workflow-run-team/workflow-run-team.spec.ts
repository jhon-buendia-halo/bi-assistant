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

  it("tells an orchestrator's step as a relay: her steps, Michael's work under her hand-off, his queries one click away", () => {
    const done = (label: string, tool: string, over = {}) => ({
      label,
      state: 'done' as const,
      rows: null,
      query: false,
      tool,
      detail: '',
      ...over,
    });
    const el = render([
      story('orchestrate', 'Avery', 'done', {
        sentence:
          'I asked Michael to work on your question, then checked the answer before handing it to you.',
        queries: 1,
        relay: [
          {
            kind: 'step',
            step: done(
              'Checked my playbook for this kind of question',
              'skill',
            ),
          },
          {
            kind: 'step',
            step: done('Asked Michael: “How many goals?”', 'answer_from_data'),
          },
          {
            kind: 'teammate',
            teammate: {
              key: 'insights-analyst',
              name: 'Michael',
              role: 'Insights Analyst',
            },
            steps: [
              done('Added up the goals', 'run_readonly_sql', {
                query: true,
                rows: '2 rows',
              }),
              done('Wrote the answer', ''),
            ],
            queries: 1,
            state: 'done',
          },
        ],
      }),
    ]);
    const opened: string[] = [];
    fixture.componentInstance.openNode.subscribe((id) => opened.push(id));
    const queried: string[] = [];
    fixture.componentInstance.openQuery.subscribe((e) =>
      queried.push(`${e.stepId}: ${e.query.step.label}`),
    );
    // Folded once she is done; the row's own data link gives way to his.
    expect(el.querySelector('[data-testid="agent-activity"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="workflow-run-team-open-orchestrate"]'),
    ).toBeNull();
    const toggle = el.querySelector<HTMLButtonElement>(
      '[data-testid="workflow-run-relay-toggle"]',
    )!;
    expect(toggle.textContent?.trim()).toBe('Show what the team did');
    toggle.click();
    fixture.detectChanges();
    const steps = Array.from(
      el.querySelectorAll('[data-testid="workflow-run-relay-step"]'),
    ).map((s) => s.textContent?.replace(/\s+/g, ' ').trim());
    expect(steps).toEqual([
      'Checked my playbook for this kind of question',
      'Asked Michael: “How many goals?”',
    ]);
    const michael = el.querySelector<HTMLElement>(
      '[data-testid="workflow-run-relay-teammate"]',
    )!;
    expect(michael.getAttribute('data-agent')).toBe('insights-analyst');
    expect(michael.textContent).toContain('Michael');
    expect(michael.textContent).toContain('Wrote the answer');
    const link = michael.querySelector<HTMLButtonElement>(
      '[data-testid="workflow-run-relay-queries"]',
    )!;
    expect(link.textContent?.trim()).toBe("See Michael's query and data");
    // His queries open in the query inspector, never the step's dialog.
    link.click();
    michael
      .querySelector<HTMLButtonElement>(
        'button[data-testid="workflow-run-relay-teammate-step"]',
      )!
      .click();
    expect(queried).toEqual([
      'orchestrate: Added up the goals',
      'orchestrate: Added up the goals',
    ]);
    expect(opened).toEqual([]);
  });

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
