import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NodeToolView } from '../../models/workflow-node.model';
import { ActivityStep } from '../../services/agent-activity';
import { RelayItem } from '../../services/team-relay';
import { StoryQueryOpen } from '../workflow-step-story/workflow-step-story';
import { WorkflowTeammateWork } from './workflow-teammate-work';

const SQL = 'SELECT team, SUM(goals) FROM goals GROUP BY team';

const query = (label: string, input = SQL): ActivityStep => ({
  label,
  state: 'done',
  rows: '12 rows',
  query: true,
  tool: 'run_readonly_sql',
  detail: '',
  input,
});

const TOOL: NodeToolView = {
  name: 'answer_from_data',
  description: 'Michael, working alone with you.',
  inputs: ['brief'],
  stepId: 'orchestrate',
  stepTitle: 'Orchestrate',
  agentKey: 'chief-of-staff',
  agentName: 'Avery',
  agentRole: 'Chief of Staff',
  ran: true,
  calls: [
    {
      tool: 'answer_from_data',
      input: 'Which team scored most?\n\nRank with ties.',
      reply: '**France scored most: 14.**',
      durationMs: 21_900,
      finished: true,
    },
  ],
  totalDurationMs: 21_900,
  teammate: {
    key: 'insights-analyst',
    name: 'Michael',
    role: 'Insights Analyst',
  },
};

const RELAY: RelayItem[] = [
  {
    kind: 'step',
    step: {
      ...query('Asked Michael'),
      query: false,
      tool: 'answer_from_data',
      agent: 'chief-of-staff',
    },
  },
  {
    kind: 'teammate',
    teammate: {
      key: 'insights-analyst',
      name: 'Michael',
      role: 'Insights Analyst',
    },
    steps: [
      query('Sum the goals of each team'),
      query('Check the stages', 'SELECT stage FROM matches'),
      {
        label: 'Wrote the answer',
        state: 'done',
        rows: null,
        query: false,
        tool: '',
        detail: '',
      },
    ],
    queries: 2,
    state: 'done',
  },
];

describe('WorkflowTeammateWork (a teammate sub-node: asked, did, handed back)', () => {
  let fixture: ComponentFixture<WorkflowTeammateWork>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = (id: string) =>
    (el().querySelector(`[data-testid="${id}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  function render(
    tool: NodeToolView,
    extra: {
      relay?: RelayItem[] | null;
      data?: unknown[] | null;
      hasRun?: boolean;
    } = {},
  ) {
    fixture = TestBed.createComponent(WorkflowTeammateWork);
    fixture.componentRef.setInput('tool', tool);
    fixture.componentRef.setInput('relay', extra.relay ?? null);
    fixture.componentRef.setInput('answerData', extra.data ?? null);
    fixture.componentRef.setInput('hasRun', extra.hasRun ?? tool.ran);
    fixture.detectChanges();
  }

  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [WorkflowTeammateWork] }),
  );

  it('tells what Avery asked (the whole brief), what Michael did and what he handed back, in his words', () => {
    render(TOOL, { relay: RELAY });
    expect(text('workflow-teammate-asked')).toContain('What Avery asked');
    expect(text('workflow-teammate-asked')).toContain(
      'Which team scored most? Rank with ties.',
    );
    expect(text('workflow-teammate-did')).toContain(
      'What Michael did · 2 queries',
    );
    const steps = el().querySelectorAll(
      '[data-testid="workflow-teammate-step"]',
    );
    // The relay's closing line is the reply below, not a step.
    expect(
      Array.from(steps).map((s) =>
        s.querySelector('.flex-1')?.textContent?.trim(),
      ),
    ).toEqual(['Sum the goals of each team', 'Check the stages']);
    expect(steps[0].textContent).toContain('12 rows');
    expect(text('workflow-teammate-reply')).toContain(
      'What Michael handed back to Avery',
    );
    expect(
      el().querySelector('[data-testid="workflow-teammate-reply"] strong')
        ?.textContent,
    ).toBe('France scored most: 14.');
    expect(
      el().querySelector('[data-testid="workflow-teammate-call"] > p'),
    ).toBeNull();
  });

  it('opens a query the answer holds in the query inspector; one it does not hold has no link', () => {
    render(TOOL, {
      relay: RELAY,
      data: [{ tool: 'run_readonly_sql', input: 'SELECT stage FROM matches' }],
    });
    const links = el().querySelectorAll<HTMLButtonElement>(
      '[data-testid="workflow-teammate-open-query"]',
    );
    expect(links.length).toBe(1);
    const opened: StoryQueryOpen[] = [];
    fixture.componentInstance.openQuery.subscribe((o) => opened.push(o));
    links[0].click();
    expect(opened.map((o) => o.index)).toEqual([0]);
  });

  it('numbers the calls when Avery called him twice, and says when a call failed or is under way', () => {
    render({
      ...TOOL,
      calls: [
        {
          tool: 'answer_from_data',
          input: 'First',
          error: 'model down',
          finished: true,
        },
        { tool: 'answer_from_data', input: 'Second', finished: false },
      ],
    });
    const calls = el().querySelectorAll(
      '[data-testid="workflow-teammate-call"]',
    );
    expect(calls.length).toBe(2);
    expect(calls[0].querySelector('p')?.textContent).toContain('Call 1 of 2');
    expect(calls[0].textContent).toContain(
      "Avery couldn't reach Michael: model down",
    );
    expect(calls[1].textContent).toContain(
      'Not yet: Michael is still working.',
    );
  });

  it('without a call: why there is nothing to tell, and the tool behind it in the technical details', () => {
    render({ ...TOOL, ran: false, calls: [] }, { hasRun: false });
    expect(text('workflow-teammate-empty')).toBe(
      'Run the workflow to see what Michael does when Avery calls them.',
    );
    render({ ...TOOL, calls: [] }, { hasRun: true });
    expect(text('workflow-teammate-empty')).toBe(
      'Avery did not call Michael in the run shown.',
    );
    expect(text('workflow-teammate-tech')).toContain('answer_from_data');
    const steps: string[] = [];
    fixture.componentInstance.openStep.subscribe((id) => steps.push(id));
    el()
      .querySelector<HTMLButtonElement>(
        '[data-testid="workflow-teammate-step-link"]',
      )!
      .click();
    expect(steps).toEqual(['orchestrate']);
  });
});
