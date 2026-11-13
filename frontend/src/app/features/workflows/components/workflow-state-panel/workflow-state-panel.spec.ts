import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NodeInspection } from '../../models/workflow-node.model';
import {
  FIXTURE_NODES,
  FIXTURE_NODES_NOT_RUN,
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
      selectedId?: string | null;
    } = {},
  ) {
    fixture = TestBed.createComponent(WorkflowStatePanel);
    fixture.componentRef.setInput('nodes', opts.nodes ?? FIXTURE_NODES);
    fixture.componentRef.setInput('selectedId', opts.selectedId ?? null);
    fixture.detectChanges();
  }

  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [WorkflowStatePanel] }),
  );

  /** FIXTURE_NODES with the run status (and attempts) of chosen nodes replaced. */
  function withRuns(
    runs: Record<
      string,
      { status: NonNullable<NodeInspection['run']>['status']; startedAt?: string; attempts?: number }
    >,
  ): NodeInspection[] {
    return FIXTURE_NODES.map((n) => {
      const r = runs[n.nodeId];
      if (r === undefined) return n;
      const run = {
        ...(n.run ?? { durationMs: null, toolCalls: [] }),
        status: r.status,
        ...(r.startedAt ? { startedAt: r.startedAt } : {}),
      };
      return {
        ...n,
        run,
        ...(r.attempts ? { attempts: Array.from({ length: r.attempts }, () => run) } : {}),
      };
    });
  }

  it('has no header of its own and is labelled Logs', () => {
    make();
    expect(byId('workflow-state')?.getAttribute('aria-label')).toBe('Logs');
    expect(byId('workflow-state-toggle')).toBeNull();
    expect(byId('workflow-state-status')).toBeNull();
    expect(byId('workflow-state-progress')).toBeNull();
    expect(byId('workflow-state-run-id')).toBeNull();
    // The Logs panel's header (an h2) names the panel; this h3 names the list.
    expect(el().querySelector('h3')?.textContent).toContain('Nodes');
  });

  describe('Logs rows', () => {
    const row = (id: string) => byId(`workflow-state-node-${id}`)!;

    it('marks every node pending before a run, with the Not run label', () => {
      make({ nodes: FIXTURE_NODES_NOT_RUN });
      for (const id of ['start', 'receive', 'analyse', 'end']) {
        expect(row(id).getAttribute('data-state')).toBe('pending');
        expect(row(id).querySelector('.sr-only')?.textContent?.trim()).toBe('Not run');
        expect(row(id).hasAttribute('aria-current')).toBeFalse();
      }
    });

    it('lists Start and End as rows with their state', () => {
      make();
      expect(row('start').getAttribute('data-state')).toBe('done');
      expect(row('end').getAttribute('data-state')).toBe('done');
      expect(row('start').textContent).toContain('Start');
      expect(row('end').textContent).toContain('End');
    });

    it('sets data-state, a marker and a screen-reader label per status', () => {
      const cases: [string, string, string][] = [
        ['success', 'done', 'Done'],
        ['failed', 'failed', 'Failed'],
        ['skipped', 'skipped', 'Skipped'],
        ['stopped', 'stopped', 'Stopped'],
      ];
      for (const [status, state, label] of cases) {
        make({
          nodes: withRuns({
            receive: { status: status as 'success' },
          }),
        });
        const r = row('receive');
        expect(r.getAttribute('data-state')).toBe(state);
        expect(r.querySelector('lucide-angular, svg')).not.toBeNull();
        expect(r.querySelector('.sr-only')?.textContent?.trim()).toBe(label);
      }
    });

    it('marks the running node current with aria-current and its elapsed time', () => {
      make({
        nodes: withRuns({
          analyse: {
            status: 'running',
            startedAt: new Date(Date.now() - 5_000).toISOString(),
          },
        }),
      });
      const r = row('analyse');
      expect(r.getAttribute('data-state')).toBe('current');
      expect(r.getAttribute('aria-current')).toBe('step');
      expect(r.querySelector('.sr-only')?.textContent?.trim()).toBe('Running');
      expect(text('workflow-state-elapsed')).toMatch(/^[5-7] s$/);
      expect(row('receive').querySelector('[data-testid="workflow-state-elapsed"]')).toBeNull();
    });

    it('shows a Waiting for you chip for a suspended node, without the sr-only label', () => {
      make({ nodes: withRuns({ analyse: { status: 'suspended' } }) });
      const r = row('analyse');
      expect(r.getAttribute('data-state')).toBe('waiting');
      expect(r.querySelector('.chip')?.textContent?.trim()).toBe('Waiting for you');
      expect(r.querySelector('.sr-only')).toBeNull();
    });

    it('shows Skipped as the time of a skipped node', () => {
      make({ nodes: withRuns({ receive: { status: 'skipped' } }) });
      expect(row('receive').textContent).toContain('Skipped');
    });

    it('shows ×n and an sr-only count for a node that ran more than once', () => {
      make({ nodes: withRuns({ analyse: { status: 'success', attempts: 3 } }) });
      const r = row('analyse');
      expect(r.textContent).toContain('×3');
      expect(r.textContent).toContain('Ran 3 times');
      expect(row('receive').textContent).not.toContain('×');
    });
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
