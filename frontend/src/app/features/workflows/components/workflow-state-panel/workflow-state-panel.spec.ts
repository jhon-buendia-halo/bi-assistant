import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowStateSummary } from '../../models/workflow-node.model';
import {
  FIXTURE_NODES,
  FIXTURE_NODES_NOT_RUN,
  FIXTURE_SUMMARY,
} from '../workflow-node-dialog/workflow-node.testing';
import { buildNodeInspections } from '../../services/workflow-node-inspection';
import {
  GRAPH_RETRY_RUN,
  GRAPH_WORKFLOW,
} from '../../services/workflow-graph.testing';
import { WorkflowStatePanel } from './workflow-state-panel';

describe('WorkflowStatePanel', () => {
  let fixture: ComponentFixture<WorkflowStatePanel>;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (id: string) =>
    byId(id)?.textContent?.replace(/\s+/g, ' ').trim();

  function make(
    opts: {
      nodes?: typeof FIXTURE_NODES;
      summary?: WorkflowStateSummary;
      selectedId?: string | null;
      open?: boolean;
    } = {},
  ) {
    fixture = TestBed.createComponent(WorkflowStatePanel);
    fixture.componentRef.setInput('nodes', opts.nodes ?? FIXTURE_NODES);
    fixture.componentRef.setInput('summary', opts.summary ?? FIXTURE_SUMMARY);
    fixture.componentRef.setInput('selectedId', opts.selectedId ?? null);
    fixture.componentRef.setInput('open', opts.open ?? true);
    fixture.detectChanges();
  }

  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [WorkflowStatePanel] }),
  );

  it('summarises the run', () => {
    make();
    expect(text('workflow-state-toggle')).toBe('Workflow state');
    expect(text('workflow-state-status')).toBe('success');
    expect(text('workflow-state-progress')).toBe('4 of 4 nodes ran');
    expect(text('workflow-state-duration')).toBe('14.0 s');
    expect(text('workflow-state-run-id')).toBe('run_8f21c4');
  });

  it('says so when there is no run', () => {
    make({
      nodes: FIXTURE_NODES_NOT_RUN,
      summary: {
        status: null,
        ran: 0,
        total: 4,
        durationMs: null,
        runId: null,
        invalidFields: 0,
      },
    });
    expect(text('workflow-state-progress')).toBe('0 of 4 nodes ran');
    expect(text('workflow-state-run-id')).toBe(
      "No run yet. Execute the workflow to see each node's data.",
    );
    expect(byId('workflow-state-status')).toBeNull();
    expect(byId('workflow-state-invalid')).toBeNull();
  });

  it('says how many fields refused the last Execute', () => {
    const refused: WorkflowStateSummary = {
      status: null,
      ran: 0,
      total: 4,
      durationMs: null,
      runId: null,
      invalidFields: 2,
    };
    make({ nodes: FIXTURE_NODES_NOT_RUN, summary: refused });
    expect(text('workflow-state-invalid')).toBe('Input invalid: 2 fields');
    make({ nodes: FIXTURE_NODES_NOT_RUN, summary: { ...refused, invalidFields: 1 } });
    expect(text('workflow-state-invalid')).toBe('Input invalid: 1 field');
  });

  it('toggles open and closed through openChange', () => {
    make();
    const changes: boolean[] = [];
    fixture.componentInstance.openChange.subscribe((v) => changes.push(v));
    expect(byId('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    byId('workflow-state-toggle')?.click();
    expect(changes).toEqual([false]);

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(byId('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(byId('workflow-state-node-all')).toBeNull();
  });

  it('lists All nodes first, then each node with its duration', () => {
    make();
    const buttons = Array.from(
      el().querySelectorAll<HTMLElement>(
        '[data-testid^="workflow-state-node-"]',
      ),
    );
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual([
      'workflow-state-node-all',
      'workflow-state-node-start',
      'workflow-state-node-receive',
      'workflow-state-node-analyse',
      'workflow-state-node-end',
    ]);
    expect(text('workflow-state-node-analyse')).toContain('13.9 s');
    expect(text('workflow-state-node-receive')).toContain('2 ms');
    expect(byId('workflow-state-node-all')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows the table for All nodes and selects from a row', () => {
    make();
    const table = byId('workflow-state-table')!;
    expect(table.textContent).toContain('Node');
    expect(table.textContent).toContain('Duration');
    expect(table.textContent).toContain('LLM');
    expect(table.textContent).toContain('Done');
    const selected: (string | null)[] = [];
    fixture.componentInstance.selectNode.subscribe((id) => selected.push(id));
    Array.from(table.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Analyse')
      ?.click();
    expect(selected).toEqual(['analyse']);
  });

  it('selects a node from the list and All nodes clears it', () => {
    make();
    const selected: (string | null)[] = [];
    fixture.componentInstance.selectNode.subscribe((id) => selected.push(id));
    byId('workflow-state-node-receive')?.click();
    byId('workflow-state-node-all')?.click();
    expect(selected).toEqual(['receive', null]);
  });

  it('opens a node on double click', () => {
    make();
    const opened: string[] = [];
    fixture.componentInstance.openNode.subscribe((id) => opened.push(id));
    byId('workflow-state-node-analyse')?.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    expect(opened).toEqual(['analyse']);
  });

  it('shows the selected node: input, output and context', () => {
    make({ selectedId: 'analyse' });
    expect(
      byId('workflow-state-node-analyse')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(byId('workflow-state-table')).toBeNull();
    expect(byId('workflow-state-detail')?.textContent).toContain('Analyse');
    expect(byId('workflow-state-input')?.textContent).toContain(
      'Top 5 states?',
    );
    expect(byId('workflow-state-output')?.textContent).toContain('"calls": 3');
    // JSON and Schema only
    expect(
      byId('workflow-state-output')?.querySelector(
        '[data-testid="workflow-data-mode-table"]',
      ),
    ).toBeNull();
    const context = text('workflow-state-context')!;
    expect(context).toContain('Workflow input');
    expect(context).toContain('question');
    expect(context).toContain('Earlier steps');
    expect(context).toContain('Receive question');
    expect(context).toContain('anthropic/claude-sonnet-5-5');
    expect(context).toContain('list_entities, run_readonly_sql');
  });

  it('has no Context column for Start and End', () => {
    make({ selectedId: 'start' });
    expect(byId('workflow-state-context')).toBeNull();
    expect(byId('workflow-state-output')?.textContent).toContain(
      'Top 5 states?',
    );
  });

  it('shows the not-run text for a node that has not run', () => {
    make({
      nodes: FIXTURE_NODES_NOT_RUN,
      summary: {
        status: null,
        ran: 0,
        total: 4,
        durationMs: null,
        runId: null,
        invalidFields: 0,
      },
      selectedId: 'analyse',
    });
    expect(byId('workflow-state-input')?.textContent).toContain(
      'This node has not run yet. Execute the workflow to see its data.',
    );
  });

  it('switches the detail between the attempts of a repeated step, the last one first', () => {
    const nodes = buildNodeInspections({
      workflow: GRAPH_WORKFLOW,
      run: GRAPH_RETRY_RUN,
      liveToolCalls: [],
      running: false,
    });
    make({ nodes, selectedId: 'analyse' });
    const one = byId('workflow-attempt-1')!;
    expect(byId('workflow-attempt-2')?.getAttribute('aria-pressed')).toBe('true');
    expect(byId('workflow-state-input')?.textContent).toContain('second');
    one.click();
    fixture.detectChanges();
    expect(one.getAttribute('aria-pressed')).toBe('true');
    expect(byId('workflow-state-input')?.textContent).toContain('first');

    fixture.componentRef.setInput('selectedId', 'plan');
    fixture.detectChanges();
    expect(byId('workflow-attempts')).toBeNull();
  });
});
