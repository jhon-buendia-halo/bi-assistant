import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NodeInspection } from '../../models/workflow-node.model';
import { WorkflowNodeDialog } from './workflow-node-dialog';
import {
  FIXTURE_NODES,
  FIXTURE_NODES_NOT_RUN,
  FIXTURE_WORKFLOW,
} from './workflow-node.testing';

describe('WorkflowNodeDialog', () => {
  let fixture: ComponentFixture<WorkflowNodeDialog>;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (id: string) =>
    byId(id)?.textContent?.replace(/\s+/g, ' ').trim();
  const node = (id: string) => FIXTURE_NODES.find((n) => n.nodeId === id)!;

  function open(n: NodeInspection, runId: string | null = 'run_8f21c4') {
    fixture = TestBed.createComponent(WorkflowNodeDialog);
    fixture.componentRef.setInput('node', n);
    fixture.componentRef.setInput('workflow', FIXTURE_WORKFLOW);
    fixture.componentRef.setInput('runId', runId);
    fixture.detectChanges();
  }

  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [WorkflowNodeDialog] }),
  );

  it('is a modal dialog with the node title, a badge and the agent line', () => {
    open(node('analyse'));
    const dialog = byId('workflow-ndv');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(text('workflow-ndv-title')).toBe('Analyse');
    expect(dialog?.textContent).toContain('LLM');
    expect(dialog?.textContent).toContain(
      'Questions to Insights v2 · ≤ 15 steps',
    );
    expect(byId('workflow-ndv-input')).not.toBeNull();
    expect(byId('workflow-ndv-params')).not.toBeNull();
    expect(byId('workflow-ndv-output')).not.toBeNull();
  });

  it('shows an agent step: input, parameters, tool calls and output', () => {
    open(node('analyse'));
    expect(byId('workflow-ndv-input')?.textContent).toContain('Top 5 states?');
    expect(text('workflow-step-field-id')).toBe('analyse');
    expect(text('workflow-step-field-kind')).toBe('LLM (agent call)');
    expect(text('workflow-step-field-agent')).toContain(
      'Questions to Insights v2',
    );
    expect(text('workflow-step-field-model')).toBe(
      'anthropic/claude-sonnet-5-5',
    );
    expect(text('workflow-step-field-tools')).toBe(
      'list_entities, run_readonly_sql',
    );
    expect(text('workflow-step-field-max-steps')).toBe('15');
    expect(text('workflow-step-field-exits')).toBe(
      'Model error → fails · Stop → ends here',
    );
    expect(text('workflow-step-field-input')).toBe('question, catalog');
    expect(text('workflow-step-field-output')).toBe('calls, stopped');
    expect(text('workflow-step-field-system-prompt')).toBe(
      'You are a data analyst.',
    );
    expect(el().textContent).toContain(
      "The agent's base prompt; each run adds its own context.",
    );
    expect(el().textContent).not.toContain('Shortened to 20 000 characters.');

    expect(text('workflow-ndv-output-status')).toBe('Done');
    const calls = el().querySelectorAll(
      '[data-testid="workflow-ndv-tool-call"]',
    );
    expect(calls.length).toBe(3);
    expect(calls[0].textContent).toContain('list_entities');
    expect(calls[0].textContent).toContain('200 ms');
    expect(calls[1].textContent).toContain('SELECT state FROM claims');
    expect(calls[1].textContent).toContain('1.1 s');
    expect(calls[1].textContent).toContain('5 rows');
    expect(calls[2].textContent).toContain('No such entity');
    expect(byId('workflow-ndv-output')?.textContent).toContain('"calls": 3');
  });

  it('says so when an agent step recorded no tool calls', () => {
    const analyse = node('analyse');
    open({ ...analyse, run: { ...analyse.run!, toolCalls: [] } });
    expect(byId('workflow-ndv-output')?.textContent).toContain(
      'No tool calls recorded.',
    );
  });

  it('notes a shortened system prompt', () => {
    const analyse = node('analyse');
    open({
      ...analyse,
      agent: { ...analyse.agent!, systemPromptTruncated: true },
    });
    expect(el().textContent).toContain('Shortened to 20 000 characters.');
  });

  it('opens the agent from its link', () => {
    open(node('analyse'));
    const keys: string[] = [];
    fixture.componentInstance.openAgent.subscribe((k) => keys.push(k));
    byId('workflow-step-field-agent')?.querySelector('button')?.click();
    expect(keys).toEqual(['qti']);
  });

  it('shows a code step without agent fields', () => {
    open(node('receive'));
    expect(text('workflow-step-field-kind')).toBe('Code');
    expect(byId('workflow-step-field-agent')).toBeNull();
    expect(byId('workflow-step-field-system-prompt')).toBeNull();
    expect(text('workflow-step-field-exits')).toBe('Empty question → fails');
    expect(el().textContent).toContain('CODE');
    expect(el().textContent).not.toContain('Tool calls');
  });

  it('shows Exits as None when a step has none', () => {
    const receive = node('receive');
    open({ ...receive, step: { ...receive.step!, exits: [] } });
    expect(text('workflow-step-field-exits')).toBe('None');
  });

  it('switches to Settings: status, duration and run id', () => {
    open(node('analyse'));
    byId('workflow-ndv-tab-settings')?.click();
    fixture.detectChanges();
    expect(
      byId('workflow-ndv-tab-settings')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(text('workflow-ndv-setting-status')).toBe('Done');
    expect(text('workflow-ndv-setting-duration')).toBe('13.9 s');
    expect(text('workflow-ndv-setting-run-id')).toBe('run_8f21c4');
    expect(byId('workflow-step-field-id')).toBeNull();
  });

  it('shows the not-run states', () => {
    open(FIXTURE_NODES_NOT_RUN[2], null);
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      'This node has not run yet. Execute the workflow to see its data.',
    );
    expect(byId('workflow-ndv-output-status')).toBeNull();
    byId('workflow-ndv-tab-settings')?.click();
    fixture.detectChanges();
    expect(text('workflow-ndv-setting-status')).toBe('Not run yet');
    expect(text('workflow-ndv-setting-run-id')).toBe('Not run yet');
  });

  it('says no input was recorded when the node ran without one', () => {
    const receive = node('receive');
    open({ ...receive, run: { ...receive.run!, input: undefined } });
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      'No input recorded for this run.',
    );
  });

  it('shows a dropped input as truncated', () => {
    const receive = node('receive');
    open({
      ...receive,
      run: { ...receive.run!, input: undefined, inputTruncated: true },
    });
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      'Larger than 20 000 characters, not kept.',
    );
  });

  it('shows a step error', () => {
    const receive = node('receive');
    open({
      ...receive,
      run: {
        ...receive.run!,
        status: 'failed',
        output: undefined,
        error: 'Empty question',
      },
    });
    expect(text('workflow-ndv-output-error')).toBe('Empty question');
    expect(text('workflow-ndv-output-status')).toBe('Failed');
  });

  it('shows the Start node: description, trigger, inputs, outputs, agents', () => {
    open(node('start'));
    expect(text('workflow-panel-description')).toBe(
      'Answers a question over the datasets.',
    );
    expect(text('workflow-panel-trigger')).toBe('Runs on an input');
    expect(text('workflow-param-question')).toContain('Question');
    expect(text('workflow-param-question')).toContain('required');
    expect(text('workflow-param-datasets')).not.toContain('required');
    expect(text('workflow-panel-output')).toBe('calls, stopped');
    expect(byId('workflow-ndv-output')?.textContent).toContain('Top 5 states?');
    const keys: string[] = [];
    fixture.componentInstance.openAgent.subscribe((k) => keys.push(k));
    byId('workflow-agent-qti')?.click();
    expect(keys).toEqual(['qti']);
  });

  it('shows the End node: the last output as input, the run line and output', () => {
    open(node('end'));
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      '"stopped": false',
    );
    expect(text('workflow-ndv-output-line')).toBe('Run succeeded');
    expect(byId('workflow-ndv-output')?.textContent).toContain(
      'California leads.',
    );
  });

  it('shows the End node of a failed run with its error', () => {
    const end = node('end');
    open({
      ...end,
      run: { ...end.run!, status: 'skipped', output: undefined, error: 'Boom' },
    });
    expect(text('workflow-ndv-output-line')).toBe('Run failed');
    expect(text('workflow-ndv-output-error')).toBe('Boom');
  });

  it('closes on Escape and on Close', () => {
    open(node('analyse'));
    let closed = 0;
    fixture.componentInstance.close.subscribe(() => closed++);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(closed).toBe(1);
    byId('workflow-ndv-close')?.click();
    expect(closed).toBe(2);
  });

  it('focuses Close first and keeps Tab inside the dialog', async () => {
    open(node('analyse'));
    await fixture.whenStable();
    const close = byId('workflow-ndv-close') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);

    const focusable = Array.from(
      byId('workflow-ndv')!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const last = focusable[focusable.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });
});
