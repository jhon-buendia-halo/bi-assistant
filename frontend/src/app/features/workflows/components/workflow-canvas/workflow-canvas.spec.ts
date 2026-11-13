import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { WorkflowDetail } from '../../models/workflow.model';
import { GRAPH_WORKFLOW } from '../../services/workflow-graph.testing';
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
      exits: [],
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
      20, 116, 212, 308, 472, 568,
    ]);
    // Squares and the taller agent share one centre line.
    expect(nodes.map((n) => n.style.top)).toEqual([
      '82px',
      '82px',
      '82px',
      '64px',
      '82px',
      '82px',
    ]);
    expect(q('workflow-node-analyse')?.style.width).toBe('120px');
    expect(q('workflow-node-start')?.style.width).toBe('52px');
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
      'Invalid input → not started',
      'Model error → fails',
      'Stop → ends here',
    ]);
    // Exits sit inside their node: above the agent, under a square's label.
    const agentExit = q('workflow-node-analyse')!.querySelector<HTMLElement>(
      '[data-testid="workflow-node-exit"]',
    )!;
    expect(parseFloat(agentExit.style.top)).toBeLessThan(0);
    const startExit = q('workflow-node-start')!.querySelector<HTMLElement>(
      '[data-testid="workflow-node-exit"]',
    )!;
    expect(parseFloat(startExit.style.top)).toBe(52 + 86);
    expect(
      q('workflow-node-receive-question')!.querySelector(
        '[data-testid="workflow-node-exit"]',
      ),
    ).toBeNull();
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
      'workflow-subnode-analyse-tools',
    ]);
    expect(
      subs.map((s) => [
        text(s.querySelector('.node-title')),
        text(s.querySelector('.node-subtitle')),
      ]),
    ).toEqual([
      ['claude-sonnet-5-5', 'model'],
      ['Tools', '3 tools'],
    ]);
    expect(subs.map((s) => s.tagName)).toEqual(['BUTTON', 'BUTTON']);
    expect(subs[0].getAttribute('aria-label')).toBe(
      'Model claude-sonnet-5-5 of Analyse',
    );
    expect(subs[0].hasAttribute('aria-haspopup')).toBe(false);
    expect(subs[1].getAttribute('aria-label')).toBe('Tools of Analyse: 3 tools');
    expect(subs[1].getAttribute('aria-haspopup')).toBe('menu');
    expect(subs[1].getAttribute('aria-expanded')).toBe('false');
    expect(subs[1].getAttribute('title')).toBe(
      'list_entities, describe_entity, run_readonly_sql',
    );
    expect(el.querySelectorAll('path.sub-edge').length).toBe(2);
  });

  it('an agent without tools hangs only its Model sub-node', () => {
    fixture.componentRef.setInput('workflow', {
      ...V2,
      steps: [
        {
          ...V2.steps[2],
          agent: { ...V2.steps[2].agent!, tools: [], maxSteps: 1 },
        },
      ],
    });
    fixture.detectChanges();
    expect(
      Array.from(el.querySelectorAll('.sub-node')).map((s) =>
        s.getAttribute('data-testid'),
      ),
    ).toEqual(['workflow-subnode-analyse-model']);
    expect(text(q('workflow-node-agent'))).toBe('Questions to Insights v2');
  });

  describe('the Tools sub-node opens a list of its tools', () => {
    const tools = () => q('workflow-subnode-analyse-tools')!;
    const menu = () => q('workflow-tools-menu-analyse');
    const items = () =>
      Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const key = (k: string) => {
      const event = new KeyboardEvent('keydown', {
        key: k,
        bubbles: true,
        cancelable: true,
      });
      (document.activeElement ?? menu()!).dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    const open = (how: 'click' | 'dblclick') => {
      if (how === 'click') tools().click();
      else tools().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();
      tick();
    };

    // Focus is shared browser state: start from none.
    beforeEach(() => (document.activeElement as HTMLElement | null)?.blur());

    it('a click opens it, its first tool focused; picking a tool opens that tool and closes it', fakeAsync(() => {
      expect(menu()).toBeNull();
      open('click');
      expect(menu()?.getAttribute('role')).toBe('menu');
      expect(menu()?.getAttribute('aria-label')).toBe('Tools of Analyse');
      expect(tools().getAttribute('aria-expanded')).toBe('true');
      expect(items().map(text)).toEqual([
        'list_entities',
        'describe_entity',
        'run_readonly_sql',
      ]);
      expect(items().map((i) => i.getAttribute('data-testid'))).toEqual([
        'workflow-tools-menu-item-list_entities',
        'workflow-tools-menu-item-describe_entity',
        'workflow-tools-menu-item-run_readonly_sql',
      ]);
      expect(document.activeElement).toBe(items()[0]);
      // Unscaled, outside the zoomed stage.
      expect(menu()!.closest('.canvas-stage')).toBeNull();

      items()[1].click();
      fixture.detectChanges();
      expect(opened).toEqual(['analyse-tool-describe_entity']);
      expect(menu()).toBeNull();
      expect(tools().getAttribute('aria-expanded')).toBe('false');
      expect(selected).toEqual([]);
    }));

    it('the Model sub-node opens its agent step', () => {
      q('workflow-subnode-analyse-model')!.click();
      expect(opened).toEqual(['analyse']);
      expect(menu()).toBeNull();
    });

    it('a double click opens it too', fakeAsync(() => {
      open('dblclick');
      expect(items().length).toBe(3);
      expect(opened).toEqual([]);
    }));

    it('arrow keys, Home and End move through it; Escape closes it and returns the focus', fakeAsync(() => {
      open('click');
      key('ArrowDown');
      expect(document.activeElement).toBe(items()[1]);
      key('ArrowDown');
      key('ArrowDown');
      expect(document.activeElement).toBe(items()[0]);
      key('ArrowUp');
      expect(document.activeElement).toBe(items()[2]);
      key('Home');
      expect(document.activeElement).toBe(items()[0]);
      key('End');
      expect(document.activeElement).toBe(items()[2]);
      const escape = key('Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(tools());
      expect(opened).toEqual([]);
    }));

    it('a press outside it closes it', fakeAsync(() => {
      open('click');
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(menu()).toBeNull();
    }));
  });

  it('draws one edge per pair with its field count, the fields for screen readers', () => {
    expect(el.querySelectorAll('svg path.edge').length).toBe(5);
    const cy = 82 + 26;
    expect(
      q('workflow-connector-start-receive-question')?.getAttribute('d'),
    ).toBe(`M 72 ${cy} L 116 ${cy}`);
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

  describe('declared contracts (ui.md 4.4b)', () => {
    const typed: WorkflowDetail = {
      ...V2,
      contractHash: '3f9a1c0b7d2e',
      steps: V2.steps.map((step) =>
        step.id === 'receive-question'
          ? {
              ...step,
              inputSchema: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  datasets: { type: 'array', items: { type: 'string' } },
                },
                required: ['question', 'datasets'],
              },
            }
          : step.id === 'analyse'
            ? {
                ...step,
                outputSchema: {
                  type: 'object',
                  properties: {
                    calls: { type: 'array', items: { type: 'object' } },
                    stopped: { type: 'boolean' },
                  },
                  required: ['calls', 'stopped'],
                },
              }
            : step,
      ),
    };
    const label = (id: string) => q(`workflow-connector-label-${id}`)!;
    const violation = (id: string) =>
      q(`workflow-connector-${id}`)?.getAttribute('data-violation') ?? null;

    beforeEach(() => {
      fixture.componentRef.setInput('workflow', typed);
      fixture.detectChanges();
    });

    it("types each edge's fields from the declared schema", () => {
      expect(text(label('start-receive-question').querySelector('.sr-only'))).toBe(
        'Passes on: question (string), datasets (string[])',
      );
      expect(label('analyse-wrap-up').getAttribute('title')).toBe(
        'Passes on: calls (object[]), stopped (boolean)',
      );
      // A step with no declared output keeps the names alone.
      expect(label('wrap-up-end').getAttribute('title')).toBe(
        'Passes on: sqlQueries, failedQueries, rows',
      );
    });

    it('marks the edge into a step that broke its input contract', () => {
      fixture.componentRef.setInput('statuses', {
        start: 'success',
        'receive-question': 'success',
        'load-catalog': 'success',
        analyse: 'failed',
      });
      fixture.componentRef.setInput('violations', { analyse: 'input' });
      fixture.detectChanges();
      expect(violation('load-catalog-analyse')).toBe('true');
      expect(violation('analyse-wrap-up')).toBeNull();
      expect(violation('receive-question-load-catalog')).toBeNull();
      expect(
        q('workflow-connector-load-catalog-analyse')?.getAttribute('marker-end'),
      ).toBe('url(#workflow-canvas-arrow-violation)');
      expect(
        q('workflow-connector-load-catalog-analyse')?.classList.contains(
          'violation',
        ),
      ).toBeTrue();
      expect(label('load-catalog-analyse').getAttribute('title')).toBe(
        'Passes on: question, catalog. Contract violation',
      );
    });

    it('marks the edge out of a step that broke its output contract', () => {
      fixture.componentRef.setInput('violations', { analyse: 'output' });
      fixture.detectChanges();
      expect(violation('analyse-wrap-up')).toBe('true');
      expect(violation('load-catalog-analyse')).toBeNull();
      expect(
        text(label('analyse-wrap-up').querySelector('.sr-only')),
      ).toBe('Passes on: calls (object[]), stopped (boolean). Contract violation');
      expect(el.querySelectorAll('[data-violation="true"]').length).toBe(1);
    });
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
    // 644 x 308 canvas pixels in a 600 x ~400 viewport.
    expect(level()).toBe('90%');
    expect(
      (el.querySelector('.canvas-stage') as HTMLElement).style.transform,
    ).toBe('scale(0.9)');
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
      `${644 * 1.5}px`,
    );
    for (let i = 0; i < 5; i++) click(zoomOut);
    expect(level()).toBe('40%');
    expect(zoomOut.disabled).toBe(true);
    click(q('workflow-zoom-reset')!);
    expect(level()).toBe('100%');

    const canvas = q('workflow-canvas')!;
    spyOnProperty(canvas, 'clientWidth').and.returnValue(520);
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

  it('shows a step waiting for an answer with "Waiting for you" for screen readers', () => {
    fixture.componentRef.setInput('statuses', { analyse: 'suspended' });
    fixture.detectChanges();
    const badge = q('workflow-node-analyse')?.querySelector(
      '[data-testid="workflow-node-status"]',
    );
    expect(badge?.getAttribute('data-status')).toBe('suspended');
    expect(badge?.textContent?.trim()).toBe('Waiting for you');
    expect(q('workflow-node-analyse')?.getAttribute('data-status')).toBe(
      'suspended',
    );
  });

  it('shows Start invalid when the input was refused, with "Invalid input" for screen readers', () => {
    fixture.componentRef.setInput('statuses', { start: 'invalid' });
    fixture.detectChanges();
    const badges = all('workflow-node-status');
    expect(badges.map(text)).toEqual(['Invalid input']);
    expect(badges[0].getAttribute('data-status')).toBe('invalid');
    expect(text(badges[0].querySelector('.sr-only'))).toBe('Invalid input');
    expect(q('workflow-node-start')?.getAttribute('data-status')).toBe('invalid');
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
    expect(subDone()).toEqual(['false', 'false']);

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
    expect(subDone()).toEqual(['true', 'true']);
  });

  it('marks every connector of a linear workflow `next`, with no edge labels', () => {
    expect(
      Array.from(el.querySelectorAll('path.edge')).map((p) => p.getAttribute('data-kind')),
    ).toEqual(['next', 'next', 'next', 'next', 'next']);
    expect(el.querySelector('[data-testid^="workflow-edge-label-"]')).toBeNull();
  });

  describe('a graph with a branch and a retry loop', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('workflow', GRAPH_WORKFLOW);
      fixture.detectChanges();
    });

    const kind = (id: string) => q(`workflow-connector-${id}`)?.getAttribute('data-kind');

    it('draws each edge with its kind and labels the branches and the loop', () => {
      expect(kind('plan-clarify')).toBe('branch');
      expect(kind('plan-analyse')).toBe('branch');
      expect(kind('validate-analyse')).toBe('loop');
      expect(kind('clarify-end')).toBe('next');
      expect(text(q('workflow-edge-label-plan-clarify'))).toBe('Needs clarification');
      expect(text(q('workflow-edge-label-plan-analyse'))).toBe('Clear');
      expect(text(q('workflow-edge-label-validate-analyse'))).toBe('Retry once');
      expect(q('workflow-edge-label-validate-analyse')?.getAttribute('data-kind')).toBe('loop');
      expect(text(q('workflow-edge-label-validate-write-answer'))).toBe('Valid or retried');
      expect(q('workflow-edge-label-analyse-validate')).toBeNull();
      // Every step is a node, Clarify too.
      expect(q('workflow-node-clarify')).not.toBeNull();
    });

    it("mutes the branch the run didn't take, and badges a step that ran twice", () => {
      fixture.componentRef.setInput('statuses', {
        start: 'success',
        'receive-question': 'success',
        'load-catalog': 'success',
        plan: 'success',
        clarify: 'skipped',
        analyse: 'success',
        validate: 'success',
        'write-answer': 'success',
        'wrap-up': 'success',
        end: 'success',
      });
      fixture.componentRef.setInput('attempts', { analyse: 2, validate: 2, plan: 1 });
      fixture.detectChanges();
      expect(q('workflow-node-clarify')?.getAttribute('data-skipped')).toBe('true');
      expect(q('workflow-node-analyse')?.getAttribute('data-skipped')).toBeNull();
      expect(q('workflow-connector-plan-clarify')?.getAttribute('data-skipped')).toBe('true');
      expect(q('workflow-connector-plan-clarify')?.getAttribute('data-done')).toBe('false');
      expect(q('workflow-connector-clarify-end')?.getAttribute('data-skipped')).toBe('true');
      expect(q('workflow-edge-label-plan-clarify')?.getAttribute('data-skipped')).toBe('true');
      expect(q('workflow-connector-plan-analyse')?.getAttribute('data-done')).toBe('true');
      // The loop was taken: Analyse ran again.
      expect(q('workflow-connector-validate-analyse')?.getAttribute('data-done')).toBe('true');

      const badge = (id: string) =>
        q(`workflow-node-${id}`)?.querySelector('[data-testid="workflow-node-attempts"]');
      expect(text(badge('analyse')!)).toBe('×2');
      expect(text(badge('validate')!)).toBe('×2');
      expect(badge('plan')).toBeNull();
      expect(q('workflow-node-analyse')?.textContent).toContain('ran 2 times');
    });

    it('leaves the loop undone when the step it goes back to ran once', () => {
      fixture.componentRef.setInput('statuses', { validate: 'success', analyse: 'success' });
      fixture.componentRef.setInput('attempts', { analyse: 1, validate: 1 });
      fixture.detectChanges();
      expect(q('workflow-connector-validate-analyse')?.getAttribute('data-done')).toBe('false');
      expect(all('workflow-node-attempts')).toEqual([]);
    });
  });
});
