import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowDetail } from '../../models/workflow.model';
import { WorkflowCanvas } from './workflow-canvas';

const V2: WorkflowDetail = {
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: 'Four steps.',
  kind: 'code',
  owner: 'Official',
  agents: [
    {
      key: 'assistant-v2',
      name: 'Questions to Insights v2',
      model: 'anthropic/claude-sonnet-5-5',
    },
  ],
  stepCount: 4,
  trigger: 'run',
  input: [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
    { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: [
    {
      id: 'receive-question',
      title: 'Receive question',
      kind: 'code',
      summary: 's',
      input: ['question', 'datasets'],
      output: ['question', 'datasets'],
      exits: [{ label: 'Empty question', outcome: 'fails' }],
    },
    {
      id: 'load-catalog',
      title: 'Load catalog',
      kind: 'code',
      summary: 's',
      input: ['question', 'datasets'],
      output: ['question', 'catalog'],
      exits: [],
    },
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      summary: 's',
      input: ['question', 'catalog'],
      output: ['calls', 'stopped'],
      agent: {
        key: 'assistant-v2',
        name: 'Questions to Insights v2',
        tools: ['list_entities', 'describe_entity', 'run_readonly_sql'],
        maxSteps: 15,
      },
      exits: [
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
      ],
    },
    {
      id: 'wrap-up',
      title: 'Wrap up',
      kind: 'code',
      summary: 's',
      input: ['calls', 'stopped'],
      output: ['sqlQueries', 'failedQueries', 'rows'],
      exits: [],
    },
  ],
};

describe('WorkflowCanvas (workflows R7; ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowCanvas>;
  let el: HTMLElement;
  let selected: (string | null)[];
  let opened: string[];
  let executed: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowCanvas],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkflowCanvas);
    el = fixture.nativeElement as HTMLElement;
    // A 600 x 400 canvas, so fit on load is known.
    el.style.width = '600px';
    el.style.height = '400px';
    fixture.componentRef.setInput('workflow', V2);
    selected = [];
    opened = [];
    executed = 0;
    fixture.componentInstance.selectNode.subscribe((id) => selected.push(id));
    fixture.componentInstance.openNode.subscribe((id) => opened.push(id));
    fixture.componentInstance.execute.subscribe(() => executed++);
    fixture.detectChanges();
  });

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const all = (testId: string) =>
    Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const text = (node: Element | null) => node?.textContent?.trim() ?? '';
  const level = () => text(q('workflow-zoom-level'));

  it('draws Start, the steps and End left to right, as buttons', () => {
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('.canvas-node'));
    expect(nodes.map((n) => n.getAttribute('data-testid'))).toEqual([
      'workflow-node-start',
      'workflow-node-receive-question',
      'workflow-node-load-catalog',
      'workflow-node-analyse',
      'workflow-node-wrap-up',
      'workflow-node-end',
    ]);
    expect(nodes.map((n) => n.getAttribute('data-kind'))).toEqual([
      'trigger',
      'code',
      'code',
      'agent',
      'code',
      'output',
    ]);
    expect(
      nodes.every(
        (n) =>
          n.tagName === 'BUTTON' && (n as HTMLButtonElement).type === 'button',
      ),
    ).toBe(true);
    expect(nodes.map((n) => parseFloat(n.style.left))).toEqual([
      40, 208, 376, 544, 844, 1012,
    ]);
    expect(new Set(nodes.map((n) => n.style.top))).toEqual(new Set(['84px']));
    expect(q('workflow-node-analyse')?.style.width).toBe('220px');
    expect(
      q('workflow-node-analyse')?.querySelector('.sr-only')?.textContent,
    ).toBe('Step 3:');
  });

  it('labels each node: title and id for steps, CODE / LLM badges, the agent line and the exits', () => {
    expect(all('workflow-node-title').map(text)).toEqual([
      'Receive question',
      'Load catalog',
      'Analyse',
      'Wrap up',
    ]);
    expect(all('workflow-node-id').map(text)).toEqual([
      'receive-question',
      'load-catalog',
      'analyse',
      'wrap-up',
    ]);
    expect(all('workflow-node-kind').map(text)).toEqual([
      'CODE',
      'CODE',
      'LLM',
      'CODE',
    ]);
    expect(text(q('workflow-node-agent'))).toBe(
      'Questions to Insights v2 · ≤ 15 steps',
    );
    const label = (id: string) =>
      ['.node-title', '.node-subtitle'].map((c) =>
        text(q(id)!.querySelector(c)),
      );
    expect(label('workflow-node-start')).toEqual([
      'Start',
      'question, datasets',
    ]);
    expect(label('workflow-node-end')).toEqual([
      'End',
      'sqlQueries, failedQueries, rows',
    ]);
    expect(all('workflow-node-exit').map(text)).toEqual([
      'Empty question → fails',
      'Model error → fails',
      'Stop → ends here',
    ]);
    // Exits sit inside their node: above the agent, under a square's label.
    const agentExit = q('workflow-node-analyse')!.querySelector<HTMLElement>(
      '[data-testid="workflow-node-exit"]',
    )!;
    expect(parseFloat(agentExit.style.top)).toBeLessThan(0);
    const codeExit = q(
      'workflow-node-receive-question',
    )!.querySelector<HTMLElement>('[data-testid="workflow-node-exit"]')!;
    expect(parseFloat(codeExit.style.top)).toBe(88 + 52);
  });

  it("hangs the agent's model and tools below it, behind Model* and Tools ports", () => {
    const ports = Array.from(el.querySelectorAll('.port-label')).map((p) =>
      p.textContent?.trim(),
    );
    expect(ports).toEqual(['Model', 'Tools']);
    const labels = Array.from(el.querySelectorAll('.port-label'));
    expect(labels.map((p) => p.hasAttribute('data-required'))).toEqual([
      true,
      false,
    ]);
    expect(getComputedStyle(labels[0], '::after').content).toBe('"*"');
    const subs = Array.from(el.querySelectorAll<HTMLElement>('.sub-node'));
    expect(subs.map((s) => s.getAttribute('data-testid'))).toEqual([
      'workflow-subnode-analyse-model',
      'workflow-subnode-analyse-tool-list_entities',
      'workflow-subnode-analyse-tool-describe_entity',
      'workflow-subnode-analyse-tool-run_readonly_sql',
    ]);
    expect(
      subs.map((s) => [
        text(s.querySelector('.node-title')),
        text(s.querySelector('.node-subtitle')),
      ]),
    ).toEqual([
      ['claude-sonnet-5-5', 'model'],
      ['list_entities', 'tool'],
      ['describe_entity', 'tool'],
      ['run_readonly_sql', 'tool'],
    ]);
    expect(subs[0].tagName).toBe('BUTTON');
    expect(subs[0].getAttribute('aria-label')).toBe(
      'Model claude-sonnet-5-5 of Analyse',
    );
    expect(el.querySelectorAll('path.sub-edge').length).toBe(4);
  });

  it('caps the tools at four and adds "+<n> tools"', () => {
    const agent = V2.steps[2].agent!;
    fixture.componentRef.setInput('workflow', {
      ...V2,
      steps: [
        {
          ...V2.steps[2],
          agent: { ...agent, tools: ['a', 'b', 'c', 'd', 'e'] },
        },
      ],
    });
    fixture.detectChanges();
    expect(all('workflow-subnode-analyse-more').map(text)).toEqual([
      '+1 tools',
    ]);
    expect(el.querySelectorAll('.sub-node').length).toBe(6);
  });

  it('draws one edge per pair with its field count, the fields for screen readers', () => {
    expect(el.querySelectorAll('svg path.edge').length).toBe(5);
    const cy = 84 + 44;
    expect(
      q('workflow-connector-start-receive-question')?.getAttribute('d'),
    ).toBe(`M 128 ${cy} L 208 ${cy}`);
    const label = q('workflow-connector-label-analyse-wrap-up')!;
    expect(text(label)).toBe('2 fieldsPasses on: calls, stopped');
    expect(text(label.querySelector('[aria-hidden="true"]'))).toBe('2 fields');
    expect(text(label.querySelector('.sr-only'))).toBe(
      'Passes on: calls, stopped',
    );
    expect(label.getAttribute('title')).toBe('Passes on: calls, stopped');
    expect(
      text(
        q('workflow-connector-label-wrap-up-end')?.querySelector(
          '[aria-hidden="true"]',
        ) ?? null,
      ),
    ).toBe('3 fields');
    expect(
      el.querySelector('.canvas-stage > svg')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('a click selects a node; the selected node is pressed', () => {
    q('workflow-node-analyse')!.click();
    q('workflow-node-start')!.click();
    expect(selected).toEqual(['analyse', 'start']);
    expect(opened).toEqual([]);
    fixture.componentRef.setInput('selectedId', 'analyse');
    fixture.detectChanges();
    expect(q('workflow-node-analyse')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(q('workflow-node-wrap-up')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    fixture.componentRef.setInput('selectedId', 'end');
    fixture.detectChanges();
    expect(q('workflow-node-end')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('a double click or Enter opens a node', () => {
    q('workflow-node-load-catalog')!.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    expect(opened).toEqual(['load-catalog']);
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    q('workflow-node-end')!.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(opened).toEqual(['load-catalog', 'end']);
    expect(selected).toEqual(['end']);
  });

  it('a click on a sub-node opens its agent step', () => {
    q('workflow-subnode-analyse-tool-describe_entity')!.click();
    q('workflow-subnode-analyse-model')!.click();
    expect(opened).toEqual(['analyse', 'analyse']);
    expect(selected).toEqual([]);
  });

  function pointer(type: string, x: number, y: number, target: Element): void {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }),
    );
  }

  it('a click on the background clears the selection; a drag pans instead', () => {
    const canvas = q('workflow-canvas')!;
    pointer('pointerdown', 10, 10, canvas);
    pointer('pointerup', 10, 10, canvas);
    expect(selected).toEqual([null]);

    pointer('pointerdown', 100, 100, canvas);
    pointer('pointermove', 60, 40, canvas);
    pointer('pointerup', 60, 40, canvas);
    expect(selected).toEqual([null]);

    // Pressing on a node or a sub-node is not a background click.
    pointer('pointerdown', 10, 10, q('workflow-node-analyse')!);
    pointer('pointerup', 10, 10, canvas);
    pointer('pointerdown', 10, 10, q('workflow-subnode-analyse-model')!);
    pointer('pointerup', 10, 10, canvas);
    expect(selected).toEqual([null]);
  });

  it('fits the graph on load', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    // 1140 x 404 canvas pixels in a 600 x ~400 viewport.
    expect(level()).toBe('50%');
    expect(
      (el.querySelector('.canvas-stage') as HTMLElement).style.transform,
    ).toBe('scale(0.5)');
    expect(q('workflow-zoom-fit')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('zooms in and out through the levels, resets to 100% and fits again', () => {
    const zoomIn = q('workflow-zoom-in') as HTMLButtonElement;
    const zoomOut = q('workflow-zoom-out') as HTMLButtonElement;
    const click = (b: HTMLElement) => {
      b.click();
      fixture.detectChanges();
    };
    expect(q('workflow-canvas-toolbar')?.getAttribute('role')).toBe('toolbar');
    expect(zoomIn.getAttribute('aria-label')).toBe('Zoom in');
    expect(q('workflow-zoom-reset')?.getAttribute('aria-label')).toBe(
      'Reset zoom',
    );

    click(q('workflow-zoom-reset')!);
    expect(level()).toBe('100%');
    expect(q('workflow-zoom-fit')?.getAttribute('aria-pressed')).toBe('false');
    click(zoomIn);
    click(zoomIn);
    expect(level()).toBe('150%');
    expect(zoomIn.disabled).toBe(true);
    const stage = el.querySelector('.canvas-stage') as HTMLElement;
    expect(stage.style.transform).toBe('scale(1.5)');
    expect((stage.parentElement as HTMLElement).style.width).toBe(
      `${1140 * 1.5}px`,
    );
    for (let i = 0; i < 5; i++) click(zoomOut);
    expect(level()).toBe('40%');
    expect(zoomOut.disabled).toBe(true);
    click(q('workflow-zoom-reset')!);
    expect(level()).toBe('100%');

    const canvas = q('workflow-canvas')!;
    spyOnProperty(canvas, 'clientWidth').and.returnValue(912);
    spyOnProperty(canvas, 'clientHeight').and.returnValue(800);
    click(q('workflow-zoom-fit')!);
    expect(level()).toBe('80%');
    expect(q('workflow-zoom-fit')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('Execute workflow floats over the canvas and asks to execute', () => {
    const button = q('workflow-execute') as HTMLButtonElement;
    expect(text(button)).toBe('Execute workflow');
    expect(button.type).toBe('button');
    button.click();
    expect(executed).toBe(1);
  });

  it("shows each node's run status as a badge with its word for screen readers", () => {
    expect(all('workflow-node-status')).toEqual([]);
    fixture.componentRef.setInput('statuses', {
      start: 'success',
      'receive-question': 'success',
      'load-catalog': 'failed',
      analyse: 'skipped',
      end: 'stopped',
    });
    fixture.detectChanges();
    expect(all('workflow-node-status').map(text)).toEqual([
      'Done',
      'Done',
      'Failed',
      'Skipped',
      'Stopped',
    ]);
    expect(
      all('workflow-node-status').map((b) => b.getAttribute('data-status')),
    ).toEqual(['success', 'success', 'failed', 'skipped', 'stopped']);
    expect(
      all('workflow-node-status').every(
        (b) => b.querySelector('.sr-only') !== null,
      ),
    ).toBe(true);
    expect(
      q('workflow-node-wrap-up')?.querySelector(
        '[data-testid="workflow-node-status"]',
      ),
    ).toBeNull();
    expect(q('workflow-node-load-catalog')?.getAttribute('data-status')).toBe(
      'failed',
    );
  });

  it('shows a step running live', () => {
    fixture.componentRef.setInput('statuses', { 'load-catalog': 'running' });
    fixture.detectChanges();
    expect(all('workflow-node-status').map(text)).toEqual(['Running']);
    expect(
      q('workflow-node-load-catalog')!.querySelector('.animate-spin'),
    ).not.toBeNull();
  });

  it('marks an edge done once its source succeeded, and the sub-edges once the agent did', () => {
    const done = (id: string) =>
      q(`workflow-connector-${id}`)?.getAttribute('data-done');
    const subDone = () =>
      Array.from(el.querySelectorAll('path.sub-edge')).map((p) =>
        p.getAttribute('data-done'),
      );
    expect(done('start-receive-question')).toBe('false');
    expect(subDone()).toEqual(['false', 'false', 'false', 'false']);

    fixture.componentRef.setInput('statuses', {
      start: 'success',
      'receive-question': 'success',
      'load-catalog': 'success',
      analyse: 'success',
      'wrap-up': 'running',
    });
    fixture.detectChanges();
    expect(done('start-receive-question')).toBe('true');
    expect(done('load-catalog-analyse')).toBe('true');
    expect(done('analyse-wrap-up')).toBe('true');
    expect(done('wrap-up-end')).toBe('false');
    expect(
      q('workflow-connector-start-receive-question')?.getAttribute(
        'marker-end',
      ),
    ).toBe('url(#workflow-canvas-arrow-done)');
    expect(subDone()).toEqual(['true', 'true', 'true', 'true']);
  });
});
