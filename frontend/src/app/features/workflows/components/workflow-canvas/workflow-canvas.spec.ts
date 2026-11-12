import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowDetail } from '../../models/workflow.model';
import { WorkflowCanvas } from './workflow-canvas';

const V2: WorkflowDetail = {
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: 'Four steps.',
  kind: 'code',
  owner: 'Official',
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
  stepCount: 4,
  bar: 'steps',
  trigger: 'chat',
  input: [],
  picksDatasets: true,
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
      agent: { name: 'Questions to Insights v2', tools: ['run_readonly_sql'], maxSteps: 15 },
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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowCanvas],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkflowCanvas);
    fixture.componentRef.setInput('workflow', V2);
    selected = [];
    fixture.componentInstance.selectStep.subscribe((id) => selected.push(id));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const all = (testId: string) =>
    Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const text = (node: Element | null) => node?.textContent?.trim() ?? '';

  it('draws Start, the steps in order with their ids and kind badges, then End', () => {
    const order = Array.from(
      el.querySelectorAll('.canvas-terminal, .canvas-node'),
    ).map((node) => node.getAttribute('data-testid'));
    expect(order).toEqual([
      'workflow-node-start',
      'workflow-node-receive-question',
      'workflow-node-load-catalog',
      'workflow-node-analyse',
      'workflow-node-wrap-up',
      'workflow-node-end',
    ]);
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
    expect(all('workflow-node-kind').map(text)).toEqual(['CODE', 'CODE', 'LLM', 'CODE']);
    expect(text(q('workflow-node-agent'))).toBe('Questions to Insights v2 · ≤ 15 steps');
    expect(text(q('workflow-node-start'))).toBe('Start');
    expect(text(q('workflow-node-end'))).toBe('End');
  });

  it('nodes are buttons placed by the layout, with a screen-reader step number', () => {
    const node = q('workflow-node-analyse') as HTMLButtonElement;
    expect(node.tagName).toBe('BUTTON');
    expect(node.type).toBe('button');
    expect(node.style.top).toBe('376px');
    expect(node.style.height).toBe('84px');
    expect(node.querySelector('.sr-only')?.textContent).toBe('Step 3:');
  });

  it('draws one connector per pair with what the step above passes on, and the exits', () => {
    expect(el.querySelectorAll('svg path.connector-line').length).toBe(5);
    expect(q('workflow-connector-start-receive-question')?.getAttribute('d')).toBe(
      'M 164 104 V 152',
    );
    expect(text(q('workflow-connector-label-analyse-wrap-up'))).toBe(
      'Passes on: calls, stopped',
    );
    expect(text(q('workflow-connector-label-wrap-up-end'))).toBe(
      'Passes on: sqlQueries, failedQueries, rows',
    );
    expect(all('workflow-node-exit').map(text)).toEqual([
      'Empty question → fails',
      'Model error → fails',
      'Stop → ends here',
    ]);
    expect(el.querySelector('.canvas-stage > svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('a click on a node reports it; the selected node is pressed', () => {
    q('workflow-node-analyse')!.click();
    expect(selected).toEqual(['analyse']);
    fixture.componentRef.setInput('selectedId', 'analyse');
    fixture.detectChanges();
    expect(q('workflow-node-analyse')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('workflow-node-wrap-up')?.getAttribute('aria-pressed')).toBe('false');
  });

  function pointer(type: string, x: number, y: number, target: Element): void {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
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

    // Pressing on a node is not a background click.
    pointer('pointerdown', 10, 10, q('workflow-node-analyse')!);
    pointer('pointerup', 10, 10, canvas);
    expect(selected).toEqual([null]);
  });

  it('zooms in steps between 75% and 150%, scaling the graph', () => {
    const level = () => text(q('workflow-zoom-level'));
    const zoomIn = q('workflow-zoom-in') as HTMLButtonElement;
    const zoomOut = q('workflow-zoom-out') as HTMLButtonElement;
    expect(q('workflow-canvas-toolbar')?.getAttribute('role')).toBe('toolbar');
    expect(level()).toBe('100%');
    expect(zoomIn.getAttribute('aria-label')).toBe('Zoom in');
    zoomIn.click();
    fixture.detectChanges();
    zoomIn.click();
    fixture.detectChanges();
    expect(level()).toBe('150%');
    expect(zoomIn.disabled).toBe(true);
    const stage = el.querySelector('.canvas-stage') as HTMLElement;
    expect(stage.style.transform).toBe('scale(1.5)');
    expect((stage.parentElement as HTMLElement).style.width).toBe(`${508 * 1.5}px`);
    for (let i = 0; i < 3; i++) {
      zoomOut.click();
      fixture.detectChanges();
    }
    expect(level()).toBe('75%');
    expect(zoomOut.disabled).toBe(true);
  });

  it('fit to screen picks the zoom that shows the whole graph', () => {
    const canvas = q('workflow-canvas')!;
    spyOnProperty(canvas, 'clientWidth').and.returnValue(554);
    spyOnProperty(canvas, 'clientHeight').and.returnValue(630);
    q('workflow-zoom-fit')!.click();
    fixture.detectChanges();
    expect(text(q('workflow-zoom-level'))).toBe('90%');
    expect(q('workflow-zoom-fit')?.getAttribute('aria-label')).toBe('Fit to screen');
  });

  it("shows each step's run status as a chip while a run is shown", () => {
    expect(all('workflow-node-status')).toEqual([]);
    fixture.componentRef.setInput('statuses', {
      'receive-question': 'success',
      'load-catalog': 'failed',
      analyse: 'skipped',
    });
    fixture.detectChanges();
    expect(all('workflow-node-status').map(text)).toEqual(['Done', 'Failed', 'Skipped']);
    expect(q('workflow-node-wrap-up')?.querySelector('[data-testid="workflow-node-status"]')).toBeNull();
  });
});
