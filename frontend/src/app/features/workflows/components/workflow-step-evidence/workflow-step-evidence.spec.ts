import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NodeToolCallView } from '../../models/workflow-node.model';
import { WorkflowStepEvidence } from './workflow-step-evidence';

const WINS_SQL = 'SELECT team, COUNT(*) AS wins FROM w GROUP BY team';

const CALLS: NodeToolCallView[] = [
  { tool: 'list_entities', durationMs: 200, finished: true },
  {
    tool: 'run_readonly_sql',
    input: WINS_SQL,
    rowCount: 2,
    durationMs: 1100,
    finished: true,
  },
  {
    tool: 'run_readonly_sql',
    input: 'SELECT * FROM nope',
    error: 'No such entity: nope',
    finished: true,
  },
  { tool: 'sample_rows', finished: false },
];

const OUTPUT = {
  queries: [
    {
      sql: WINS_SQL,
      rationale: 'Count wins per team',
      rows: [
        { team: 'Brazil', wins: 76 },
        { team: 'Germany', wins: 68 },
      ],
      rowCount: 2,
      truncated: false,
    },
  ],
};

describe('WorkflowStepEvidence', () => {
  let fixture: ComponentFixture<WorkflowStepEvidence>;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (id: string) =>
    Array.from(el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const flat = (node: Element | null | undefined) =>
    node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  function render(
    calls: NodeToolCallView[],
    extra: { output?: Record<string, unknown>; summary?: string | null } = {},
  ) {
    fixture = TestBed.createComponent(WorkflowStepEvidence);
    fixture.componentRef.setInput('calls', calls);
    fixture.componentRef.setInput('agentName', 'Michael');
    if (extra.output) fixture.componentRef.setInput('output', extra.output);
    if (extra.summary !== undefined) {
      fixture.componentRef.setInput('summary', extra.summary);
    }
    fixture.detectChanges();
  }

  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [WorkflowStepEvidence] }),
  );

  it('heads its rows with what the persona used and how many calls', () => {
    render(CALLS, { output: OUTPUT });
    const section = byId('workflow-step-evidence')!;
    const heading = section.querySelector('h3')!;
    expect(flat(heading)).toBe('What Michael used');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(flat(byId('workflow-step-evidence-count'))).toBe('4 tool calls');
  });

  it('shows one row per call: number, business words, rows and time, a status chip', () => {
    render(CALLS, { output: OUTPUT });
    const rows = [0, 1, 2, 3].map((i) =>
      byId(`workflow-step-evidence-row-${i}`),
    );
    expect(rows.every((r) => r !== null)).toBeTrue();
    expect(flat(rows[0])).toContain('Listed the entities of the datasets');
    expect(flat(rows[0])).toContain('200 ms');
    // The query's rationale, from the step's stored queries.
    expect(flat(rows[1])).toContain('Count wins per team');
    expect(flat(rows[1])).toContain('2 rows · 1.1 s');
    const chips = all('workflow-step-evidence-chip');
    expect(chips.map((c) => flat(c))).toEqual([
      'Done',
      'Done',
      'Failed · No such entity: nope',
      'Running…',
    ]);
    expect(chips.map((c) => c.getAttribute('data-tone'))).toEqual([
      'success',
      'success',
      'danger',
      'info',
    ]);
  });

  it('clips a long error in its chip and keeps it whole in the title', () => {
    const error = `Relation does not exist ${'x'.repeat(80)}`;
    render([
      { tool: 'run_readonly_sql', input: 'SELECT 1', error, finished: true },
    ]);
    const chip = byId('workflow-step-evidence-chip')!;
    expect(flat(chip).length).toBeLessThanOrEqual('Failed · '.length + 48);
    expect(flat(chip).endsWith('…')).toBeTrue();
    expect(chip.title).toBe(error);
  });

  it('opens a call in place: its SQL and the rows it returned, and says which', () => {
    render(CALLS, { output: OUTPUT });
    const opened: number[] = [];
    fixture.componentInstance.openCall.subscribe((i) => opened.push(i));
    const row = byId('workflow-step-evidence-row-1')!;
    const detail = byId('workflow-step-evidence-detail-1')!;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.getAttribute('aria-controls')).toBe(detail.id);
    expect(detail.hidden).toBeTrue();

    row.click();
    fixture.detectChanges();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(detail.hidden).toBeFalse();
    expect(
      flat(
        detail.querySelector('[data-testid="workflow-step-evidence-input"]'),
      ),
    ).toBe(WINS_SQL);
    expect(detail.querySelector('app-workflow-data-view')).not.toBeNull();
    expect(flat(detail)).toContain('Brazil');
    expect(opened).toEqual([1]);

    // Closing it again emits nothing.
    row.click();
    fixture.detectChanges();
    expect(detail.hidden).toBeTrue();
    expect(opened).toEqual([1]);
  });

  it('opens a failed call with its error', () => {
    render(CALLS, { output: OUTPUT });
    byId('workflow-step-evidence-row-2')!.click();
    fixture.detectChanges();
    const detail = byId('workflow-step-evidence-detail-2')!;
    expect(
      flat(
        detail.querySelector('[data-testid="workflow-step-evidence-error"]'),
      ),
    ).toBe('No such entity: nope');
    expect(flat(detail)).toContain('run_readonly_sql');
  });

  it('shows the one row of what it read when the step made no calls', () => {
    render([], { summary: 'Based on 7 rows from 2 queries' });
    expect(byId('workflow-step-evidence-row-0')).toBeNull();
    expect(byId('workflow-step-evidence-count')).toBeNull();
    expect(flat(byId('workflow-step-evidence-summary'))).toContain(
      'Based on 7 rows from 2 queries',
    );
  });

  it('says so when there is neither a call nor a summary', () => {
    render([]);
    expect(flat(byId('workflow-step-evidence-empty'))).toBe(
      'No tool calls recorded.',
    );
  });
});
