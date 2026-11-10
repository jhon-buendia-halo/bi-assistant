import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { SpanNode, TraceDetail } from '../../models/session-flow.model';
import { TraceWaterfall } from './trace-waterfall';

function span(
  id: string,
  extra: Partial<SpanNode> & Pick<SpanNode, 'kind' | 'label'>,
): SpanNode {
  return {
    id,
    parentId: null,
    depth: 0,
    type: extra.kind,
    startMs: 0,
    durationMs: 100,
    status: 'succeeded',
    callId: null,
    details: [],
    input: null,
    output: null,
    ...extra,
  };
}

const SPANS: SpanNode[] = [
  span('run', {
    kind: 'agent',
    label: 'agent run · assistant',
    type: 'agent_run',
    durationMs: 20000,
    details: [{ label: 'Agent', value: 'Questions to Insights Assistant' }],
  }),
  span('recall', {
    kind: 'memory',
    label: 'memory · recall',
    parentId: 'run',
    depth: 1,
    startMs: 20,
    durationMs: 4,
  }),
  span('gen', {
    kind: 'model',
    label: 'model call · claude-sonnet-5-5',
    parentId: 'run',
    depth: 1,
    startMs: 30,
    durationMs: 19000,
    callId: 'gen',
  }),
  span('step-1', {
    kind: 'request',
    label: 'request 1',
    parentId: 'gen',
    depth: 2,
    startMs: 5000,
    durationMs: 5000,
    callId: 'gen',
    details: [
      { label: 'Tokens', value: '12,320 in / 409 out' },
      { label: 'Finish reason', value: 'tool-calls' },
    ],
  }),
  span('tool-1', {
    kind: 'tool',
    label: 'describe_entity',
    parentId: 'step-1',
    depth: 3,
    startMs: 10000,
    durationMs: 10,
    input: '{\n  "entity": "goals"\n}',
    output: '{\n  "columns": 4\n}',
    details: [{ label: 'Tool input', value: 'goals' }],
  }),
  span('step-2', {
    kind: 'request',
    label: 'request 2',
    parentId: 'gen',
    depth: 2,
    startMs: 15000,
    durationMs: null,
    status: 'running',
    callId: 'gen',
  }),
];

const TRACE: TraceDetail = {
  traceId: 'trace-1',
  startedAt: '2026-11-10T10:00:00.000Z',
  durationMs: 20000,
  spans: SPANS,
  hiddenFramework: 3,
};

const WITH_FRAMEWORK: TraceDetail = {
  ...TRACE,
  hiddenFramework: 0,
  spans: [
    ...SPANS.slice(0, 4),
    span('inject', {
      kind: 'framework',
      label: 'skill · inject',
      parentId: 'step-1',
      depth: 3,
      startMs: 5000,
      durationMs: 2,
    }),
    ...SPANS.slice(4),
  ],
};

describe('TraceWaterfall', () => {
  let fixture: ComponentFixture<TraceWaterfall>;
  let api: jasmine.SpyObj<MonitoringApiService>;
  let el: HTMLElement;

  async function render(fail = false): Promise<void> {
    api = jasmine.createSpyObj<MonitoringApiService>('MonitoringApiService', [
      'getTrace',
    ]);
    api.getTrace.and.callFake((_id: string, framework: boolean) =>
      fail
        ? throwError(() => ({ status: 404, error: { message: 'Trace not found' } }))
        : of(framework ? WITH_FRAMEWORK : TRACE),
    );
    await TestBed.configureTestingModule({
      imports: [TraceWaterfall],
      providers: [{ provide: MonitoringApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(TraceWaterfall);
    fixture.componentRef.setInput('traceId', 'trace-1');
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const text = (node: Element | null) =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = () =>
    Array.from(
      el.querySelectorAll<HTMLButtonElement>('[data-testid^="trace-span-row-"]'),
    );
  const bar = (id: string) =>
    q(`trace-span-row-${id}`)!.querySelector(
      '[data-testid="trace-span-bar"]',
    ) as HTMLElement;

  it('loads the trace without framework spans and lists one row per span in order', async () => {
    await render();
    expect(api.getTrace).toHaveBeenCalledWith('trace-1', false);
    expect(rows().map((row) => row.getAttribute('data-testid'))).toEqual(
      SPANS.map((s) => `trace-span-row-${s.id}`),
    );
    expect(rows().every((row) => row.tagName === 'BUTTON')).toBeTrue();
  });

  it('indents each label by 14 px per level of depth', async () => {
    await render();
    const indent = (id: string) =>
      (
        q(`trace-span-row-${id}`)!.querySelector(
          '[data-testid="trace-span-label"]',
        ) as HTMLElement
      ).style.paddingLeft;
    expect(indent('run')).toBe('0px');
    expect(indent('gen')).toBe('14px');
    expect(indent('step-1')).toBe('28px');
    expect(indent('tool-1')).toBe('42px');
  });

  it('places each bar to scale on the axis, with five ticks', async () => {
    await render();
    expect(bar('run').style.left).toBe('0%');
    expect(bar('run').style.width).toBe('100%');
    expect(bar('step-1').style.left).toBe('25%');
    expect(bar('step-1').style.width).toBe('25%');
    expect(bar('tool-1').style.left).toBe('50%');
    expect(parseFloat(bar('tool-1').style.width)).toBeCloseTo(0.05, 5);
    expect(bar('tool-1').className).toContain('min-w-[3px]');
    // A running span's bar runs to the end, faded and striped.
    expect(bar('step-2').style.left).toBe('75%');
    expect(bar('step-2').style.width).toBe('25%');
    expect(bar('step-2').classList).toContain('opacity-50');
    expect(bar('step-2').getAttribute('data-running')).toBe('true');
    expect(text(q('trace-span-row-step-2'))).toContain('running');

    const ticks = Array.from(
      q('trace-axis')!.querySelectorAll('span.flex > span'),
    ).map((t) => t.textContent!.trim());
    expect(ticks).toEqual(['0 s', '5.0', '10.0', '15.0', '20.0 s']);
    expect(text(q('trace-span-row-run'))).toContain('20.00 s');
    expect(text(q('trace-span-row-recall'))).toContain('<0.01 s');
  });

  it('selects the first model request by default and shows it in the panel', async () => {
    await render();
    expect(q('trace-span-row-step-1')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('trace-span-row-run')!.getAttribute('aria-pressed')).toBe('false');
    const panel = q('trace-span-panel')!;
    expect(text(q('trace-span-panel-label'))).toBe('request 1');
    const details = Array.from(q('trace-span-details')!.children)
      .map((child) => text(child))
      .join(' ');
    expect(details).toContain('Kind Request');
    expect(details).toContain('Starts at +5.00 s');
    expect(details).toContain('Duration 5.00 s');
    expect(details).toContain('Status Succeeded');
    expect(details).toContain('Tokens 12,320 in / 409 out');
    expect(details).toContain('Finish reason tool-calls');
    expect(panel.querySelector('[data-testid="trace-span-open-call"]')).toBeTruthy();
  });

  it('selects another span on click; a tool shows its input and output, no Open call', async () => {
    await render();
    q('trace-span-row-tool-1')!.click();
    await settle();
    expect(q('trace-span-row-tool-1')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('trace-span-row-step-1')!.getAttribute('aria-pressed')).toBe('false');
    expect(text(q('trace-span-panel-label'))).toBe('describe_entity');
    expect(q('trace-span-input')!.querySelector('pre')!.textContent).toBe(
      '{\n  "entity": "goals"\n}',
    );
    expect(q('trace-span-output')).toBeTruthy();
    expect(q('trace-span-open-call')).toBeNull();
  });

  it('opens the call of a model or request span', async () => {
    await render();
    const opened: string[] = [];
    fixture.componentInstance.openCall.subscribe((id) => opened.push(id));
    q('trace-span-open-call')!.click();
    q('trace-span-row-gen')!.click();
    await settle();
    q('trace-span-open-call')!.click();
    expect(opened).toEqual(['gen', 'gen']);
  });

  it('shows "(N hidden)" and reloads with framework spans when switched on', async () => {
    await render();
    const toggle = q('trace-framework-toggle')!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(text(q('trace-framework-hidden'))).toBe('(3 hidden)');
    expect(rows().length).toBe(6);

    toggle.click();
    await settle();
    expect(api.getTrace).toHaveBeenCalledWith('trace-1', true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(q('trace-framework-hidden')).toBeNull();
    expect(rows().length).toBe(7);
    expect(q('trace-span-row-inject')).toBeTruthy();
    // The selection is kept across the reload.
    expect(q('trace-span-row-step-1')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a legend of the span kinds', async () => {
    await render();
    expect(text(q('trace-legend'))).toBe(
      'Agent Model Request Tool Memory Framework',
    );
  });

  it('shows the reason when the trace cannot be loaded', async () => {
    await render(true);
    expect(text(q('trace-error'))).toBe('Trace not found');
    expect(rows().length).toBe(0);
  });
});
