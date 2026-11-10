import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import {
  SessionDetail,
  TraceDetail,
  Turn,
} from '../../models/session-flow.model';
import { SessionFlowPage } from './session-flow';

const ASSISTANT = { id: 'assistant', name: 'Questions to Insights Assistant' };

function turn(index: number, extra: Partial<Turn> = {}): Turn {
  return {
    index,
    traceId: `trace-${index}`,
    startedAt: '2026-11-10T10:00:00.000Z',
    durationMs: 18310,
    status: 'succeeded',
    agent: ASSISTANT,
    question: 'Which team scored the most goals in total?',
    answer: 'France scored the most goals.\nCroatia is second.',
    inputTokens: 61185,
    outputTokens: 2445,
    costUsd: 0.0729,
    modelMs: 18210,
    toolMs: 50,
    error: null,
    steps: [
      {
        kind: 'model',
        callId: 'gen-1',
        stepIndex: 1,
        model: 'claude-sonnet-5-5',
        durationMs: 3530,
        inputTokens: 12320,
        outputTokens: 409,
        finishReason: 'tool-calls',
        text: "I'll start by checking how goals and matches are structured.",
      },
      {
        kind: 'tools',
        tools: [
          {
            name: 'describe_entity',
            count: 3,
            durationMs: 10,
            ok: true,
            summary: 'goals, matches, teams',
            rows: null,
          },
          {
            name: 'run_readonly_sql',
            count: 1,
            durationMs: 30,
            ok: false,
            summary: 'SELECT team FROM goals',
            rows: 12,
          },
        ],
      },
      {
        kind: 'model',
        callId: 'gen-1',
        stepIndex: 2,
        model: 'claude-sonnet-5-5',
        durationMs: 3400,
        inputTokens: 17647,
        outputTokens: 385,
        finishReason: 'stop',
        text: null,
      },
    ],
    ...extra,
  };
}

function session(extra: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 'session-1',
    name: 'Monitoring probe',
    agents: [ASSISTANT],
    turns: 2,
    firstAt: '2026-11-10T10:00:00.000Z',
    lastAt: '2026-11-10T10:01:00.000Z',
    wallMs: 20900,
    modelMs: 20800,
    toolCalls: 4,
    inputTokens: 79225,
    outputTokens: 2644,
    costUsd: 0.0776,
    errors: 0,
    status: 'succeeded',
    turnList: [
      turn(1),
      turn(2, {
        question: 'And the second?',
        answer: 'Croatia.',
        durationMs: 2590,
        steps: [
          {
            kind: 'model',
            callId: 'gen-2',
            stepIndex: 1,
            model: 'claude-sonnet-5-5',
            durationMs: 2600,
            inputTokens: 18040,
            outputTokens: 199,
            finishReason: 'stop',
            text: 'Croatia.',
          },
        ],
        inputTokens: 18040,
        outputTokens: 199,
        costUsd: 0.0047,
      }),
    ],
    ...extra,
  };
}

const TRACE: TraceDetail = {
  traceId: 'trace-1',
  startedAt: '2026-11-10T10:00:00.000Z',
  durationMs: 1000,
  hiddenFramework: 0,
  spans: [
    {
      id: 'run',
      parentId: null,
      depth: 0,
      type: 'agent_run',
      kind: 'agent',
      label: 'agent run · assistant',
      startMs: 0,
      durationMs: 1000,
      status: 'succeeded',
      callId: null,
      details: [],
      input: null,
      output: null,
    },
  ],
};

describe('SessionFlowPage', () => {
  let fixture: ComponentFixture<SessionFlowPage>;
  let api: jasmine.SpyObj<MonitoringApiService>;
  let el: HTMLElement;

  async function render(response: SessionDetail | Error = session()): Promise<void> {
    api = jasmine.createSpyObj<MonitoringApiService>('MonitoringApiService', [
      'getSession',
      'getTrace',
    ]);
    api.getSession.and.returnValue(
      response instanceof Error
        ? throwError(() => ({ status: 404, error: { message: 'Session not found' } }))
        : of(response),
    );
    api.getTrace.and.returnValue(of(TRACE));
    await TestBed.configureTestingModule({
      imports: [SessionFlowPage],
      providers: [{ provide: MonitoringApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(SessionFlowPage);
    fixture.componentRef.setInput('sessionId', 'session-1');
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
  /** The text of the node's elements, one space between adjacent ones. */
  const words = (node: Element): string => {
    const ownText = Array.from(node.childNodes).some(
      (child) =>
        child.nodeType === Node.TEXT_NODE && child.textContent!.trim() !== '',
    );
    if (ownText || node.children.length === 0) return text(node);
    return Array.from(node.children)
      .map(words)
      .filter((w) => w !== '')
      .join(' ');
  };

  it('loads the session and shows its name and totals', async () => {
    await render();
    expect(api.getSession).toHaveBeenCalledWith('session-1');
    expect(text(el.querySelector('h2'))).toBe('Monitoring probe');
    const totals = words(q('session-totals')!);
    expect(totals).toContain('Turns 2');
    expect(totals).toContain('Wall time 20.9 s');
    expect(totals).toContain('Model time 20.8 s');
    expect(totals).toContain('Tool calls 4');
    expect(totals).toContain('Tokens 79,225 / 2,644');
    expect(totals).toContain('Cost $0.0776');
    expect(totals).toContain('Errors 0');
  });

  it('offers Open chat for a session that still exists', async () => {
    await render();
    const chats: string[] = [];
    fixture.componentInstance.openChat.subscribe((id) => chats.push(id));
    q('session-open-chat')!.click();
    expect(chats).toEqual(['session-1']);
  });

  it('names a gone session "Unnamed session" with no Open chat', async () => {
    await render(session({ name: null }));
    expect(text(el.querySelector('h2'))).toBe('Unnamed session');
    expect(q('session-open-chat')).toBeNull();
  });

  it('shows each turn with its question, meta line and answer', async () => {
    await render();
    expect(q('session-turn-1')).toBeTruthy();
    expect(q('session-turn-2')).toBeTruthy();
    expect(q('turn-question-1')!.textContent).toBe(
      'Which team scored the most goals in total?',
    );
    expect(q('turn-question-2')!.textContent).toBe('And the second?');
    expect(text(q('turn-meta-1'))).toBe(
      'Turn 1 · 18.31 s · 2 model requests · 4 tools · 61,185 in / 2,445 out · $0.0729',
    );
    expect(text(q('turn-meta-2'))).toBe(
      'Turn 2 · 2.59 s · 1 model request · no tools · 18,040 in / 199 out · $0.0047',
    );
    // The answer keeps its line breaks.
    const answer = q('turn-answer-1')!;
    expect(answer.textContent).toBe(
      'France scored the most goals.\nCroatia is second.',
    );
    expect(answer.className).toContain('whitespace-pre-wrap');
    expect(q('turn-answer-more-1')).toBeNull();
    // No status chip on a succeeded turn.
    expect(q('turn-status-1')).toBeNull();
  });

  it('lists the steps: model requests and grouped tool calls', async () => {
    await render();
    const steps = q('turn-steps-1')!;
    expect(steps.tagName).toBe('OL');
    const items = steps.querySelectorAll(':scope > li');
    expect(items.length).toBe(3);
    const model = text(items[0]);
    expect(model).toContain('Model');
    expect(model).toContain('3.5 s · 12,320 in / 409 out');
    expect(model).toContain('tool-calls');
    expect(model).toContain('Open call');
    // What the request said; a request with no text shows none.
    expect(
      items[0].querySelector('[data-testid="turn-step-text"]')?.textContent?.trim(),
    ).toBe("I'll start by checking how goals and matches are structured.");
    expect(items[2].querySelector('[data-testid="turn-step-text"]')).toBeNull();

    const tools = items[1].querySelectorAll('[data-testid="turn-step-tool"]');
    expect(tools.length).toBe(2);
    expect(words(tools[0])).toBe('describe_entity ×3 0.01 s goals, matches, teams');
    expect(tools[0].querySelector('[data-testid="turn-step-tool-failed"]')).toBeNull();
    // No "×1"; rows and a failed mark when not ok.
    expect(words(tools[1])).toBe(
      'run_readonly_sql 0.03 s SELECT team FROM goals 12 rows Failed',
    );
    expect(tools[1].querySelector('[data-testid="turn-step-tool-failed"]')).toBeTruthy();
  });

  it('opens a model step\'s call', async () => {
    await render();
    const calls: string[] = [];
    fixture.componentInstance.openCall.subscribe((id) => calls.push(id));
    q('step-open-call-gen-1-2')!.click();
    q('step-open-call-gen-2-1')!.click();
    expect(calls).toEqual(['gen-1', 'gen-2']);
  });

  it('opens and hides a turn\'s timeline', async () => {
    await render();
    const toggle = q('turn-timeline-toggle-1')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(text(toggle)).toBe('Open timeline');
    expect(el.querySelector('app-trace-waterfall')).toBeNull();

    toggle.click();
    await settle();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(text(toggle)).toBe('Hide timeline');
    const waterfall = q('session-turn-1')!.querySelector('app-trace-waterfall');
    expect(waterfall).toBeTruthy();
    expect(api.getTrace).toHaveBeenCalledWith('trace-1', false);
    // Only turn 1's timeline opened.
    expect(q('session-turn-2')!.querySelector('app-trace-waterfall')).toBeNull();

    toggle.click();
    await settle();
    expect(el.querySelector('app-trace-waterfall')).toBeNull();
    expect(text(toggle)).toBe('Open timeline');
  });

  it('shows a failed turn\'s status and error', async () => {
    await render(
      session({
        turnList: [
          turn(1, {
            status: 'failed',
            error: 'The model provider timed out.',
            answer: null,
          }),
        ],
      }),
    );
    expect(text(q('turn-status-1'))).toBe('Failed');
    expect(q('turn-error-1')!.textContent).toBe('The model provider timed out.');
    expect(q('turn-answer-1')).toBeNull();
  });

  it('clamps a long answer to six lines with Show more', async () => {
    const long = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');
    await render(session({ turnList: [turn(1, { answer: long })] }));
    const answer = q('turn-answer-1')!;
    expect(answer.classList).toContain('line-clamp-6');
    const more = q('turn-answer-more-1')!;
    expect(text(more)).toBe('Show more');
    more.click();
    await settle();
    expect(answer.classList).not.toContain('line-clamp-6');
    expect(text(more)).toBe('Show less');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the reason when the session cannot be loaded', async () => {
    await render(new Error('gone'));
    expect(text(q('session-load-error'))).toBe('Session not found');
  });
});
