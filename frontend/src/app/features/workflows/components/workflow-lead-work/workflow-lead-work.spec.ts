import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityStep } from '../../services/agent-activity';
import { RelayItem } from '../../services/team-relay';
import { StoryQueryOpen } from '../workflow-step-story/workflow-step-story';
import { WorkflowLeadWork } from './workflow-lead-work';

const own = (label: string): ActivityStep => ({
  label,
  state: 'done',
  rows: null,
  query: false,
  tool: 'skill',
  detail: '',
  agent: 'chief-of-staff',
});
const query = (label: string, input: string): ActivityStep => ({
  label,
  state: 'done',
  rows: '10 rows',
  query: true,
  tool: 'run_readonly_sql',
  detail: '',
  input,
});

const RELAY: RelayItem[] = [
  { kind: 'step', step: own('Checked my playbook for this kind of question') },
  { kind: 'step', step: own('Asked Michael: “Who scored most?”') },
  {
    kind: 'teammate',
    teammate: {
      key: 'insights-analyst',
      name: 'Michael',
      role: 'Insights Analyst',
    },
    steps: [
      query('Sum the goals of each team', 'SELECT 1'),
      query('Check the stages', 'SELECT 2'),
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

describe('WorkflowLeadWork (an orchestrator: asked, did with her team, handed back)', () => {
  let fixture: ComponentFixture<WorkflowLeadWork>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = (id: string) =>
    (el().querySelector(`[data-testid="${id}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  function render(
    extra: Partial<{
      answer: string | null;
      running: boolean;
      data: unknown[] | null;
    }> = {},
  ) {
    fixture = TestBed.createComponent(WorkflowLeadWork);
    const set = fixture.componentRef.setInput.bind(fixture.componentRef);
    set('lead', 'Avery');
    set('stepId', 'orchestrate');
    set('team', [
      {
        tool: 'answer_from_data',
        key: 'insights-analyst',
        name: 'Michael',
        role: 'Insights Analyst',
      },
    ]);
    set('question', 'Who scored most?');
    set('relay', RELAY);
    set('answer', 'answer' in extra ? extra.answer : '**France, 14.**');
    set('running', extra.running ?? false);
    set('answerData', extra.data ?? null);
    fixture.detectChanges();
  }

  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [WorkflowLeadWork] }),
  );

  it('tells what you asked, what Avery did with Michael’s work under her hand-off, and her answer as Markdown', () => {
    render();
    expect(text('workflow-lead-asked')).toContain('Who scored most?');
    expect(text('workflow-lead-did')).toContain('What Avery did · 2 queries');
    expect(
      el().querySelectorAll('[data-testid="workflow-lead-step"]').length,
    ).toBe(2);
    expect(text('workflow-lead-teammate')).toContain('Michael');
    expect(text('workflow-lead-teammate')).toContain('Insights Analyst');
    expect(
      el().querySelectorAll('[data-testid="workflow-lead-teammate-step"]')
        .length,
    ).toBe(3);
    expect(text('workflow-lead-answer')).toContain(
      'What Avery handed back to you',
    );
    expect(
      el().querySelector('[data-testid="workflow-lead-answer"] strong')
        ?.textContent,
    ).toBe('France, 14.');
  });

  it("opens a teammate's whole work (their tool's node) and a query the answer holds", () => {
    render({ data: [{ tool: 'run_readonly_sql', input: 'SELECT 2' }] });
    const nodes: string[] = [];
    fixture.componentInstance.openTeammate.subscribe((id) => nodes.push(id));
    el()
      .querySelector<HTMLButtonElement>(
        '[data-testid="workflow-lead-teammate-open"]',
      )!
      .click();
    expect(nodes).toEqual(['orchestrate-tool-answer_from_data']);
    const links = el().querySelectorAll<HTMLButtonElement>(
      '[data-testid="workflow-lead-open-query"]',
    );
    expect(links.length).toBe(1);
    const opened: StoryQueryOpen[] = [];
    fixture.componentInstance.openQuery.subscribe((o) => opened.push(o));
    links[0].click();
    expect(opened.map((o) => o.index)).toEqual([0]);
  });

  it('says she is still working while there is no answer', () => {
    render({ answer: null, running: true });
    expect(text('workflow-lead-answer')).toContain(
      'Not yet: Avery is still working.',
    );
  });
});
