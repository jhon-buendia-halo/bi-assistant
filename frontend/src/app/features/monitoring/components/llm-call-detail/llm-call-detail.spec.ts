import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import {
  ContextSegment,
  ContextSegmentKey,
  LlmCallDetail,
} from '../../models/llm-call.model';
import { LlmCallDetailPage } from './llm-call-detail';

const KEYS: [ContextSegmentKey, string, 'US Health' | 'Custom'][] = [
  ['system-prompt', 'System prompt', 'US Health'],
  ['skills', 'Skill injection', 'US Health'],
  ['tools', 'Tools injection', 'US Health'],
  ['chat-history', 'Chat history', 'Custom'],
  ['dataset', 'Dataset', 'Custom'],
  ['user-prompt', 'User prompt', 'Custom'],
  ['tool-results', 'Tool calls and results', 'Custom'],
];

const TOKENS: Record<ContextSegmentKey, number> = {
  'system-prompt': 8000,
  skills: 1000,
  tools: 4000,
  'chat-history': 0,
  dataset: 4000,
  'user-prompt': 647,
  'tool-results': 0,
};

function segments(): ContextSegment[] {
  const total = Object.values(TOKENS).reduce((a, b) => a + b, 0);
  return KEYS.map(([key, label, owner]) => ({
    key,
    label,
    owner,
    chars: TOKENS[key] * 4,
    tokens: TOKENS[key],
    share: TOKENS[key] / total,
    items:
      TOKENS[key] === 0
        ? []
        : key === 'user-prompt'
          ? [{ title: 'User', text: 'Which team performed best?' }]
          : [
              { title: `${label} 1`, text: `${label} text one` },
              { title: `${label} 2`, text: `${label} text two` },
            ],
  }));
}

function detail(extra: Partial<LlmCallDetail> = {}): LlmCallDetail {
  return {
    id: 'call-1',
    traceId: 'trace-1',
    startedAt: '2026-11-10T10:00:00.000Z',
    endedAt: '2026-11-10T10:00:17.300Z',
    durationMs: 17300,
    agent: { id: 'assistant', name: 'Questions to Insights Assistant' },
    model: 'claude-opus-5-5',
    provider: 'anthropic.messages',
    session: { id: 'session-1', name: 'World Cup analysis' },
    inputTokens: 61185,
    outputTokens: 2445,
    cacheReadTokens: 40000,
    cacheWriteTokens: 1000,
    reasoningTokens: 300,
    costUsd: 0.0213,
    status: 'succeeded',
    finishReason: 'stop',
    timeToFirstTokenMs: 2100,
    error: null,
    contextLimit: 1_000_000,
    contextTokens: 17647,
    steps: [
      {
        index: 0,
        inputTokens: 15000,
        outputTokens: 400,
        finishReason: 'tool-calls',
        durationMs: 4000,
      },
      {
        index: 1,
        inputTokens: 17647,
        outputTokens: 2045,
        finishReason: 'stop',
        durationMs: 13300,
      },
    ],
    segments: segments(),
    ...extra,
  };
}

describe('LlmCallDetailPage', () => {
  let fixture: ComponentFixture<LlmCallDetailPage>;
  let api: jasmine.SpyObj<MonitoringApiService>;
  let el: HTMLElement;

  async function render(response: LlmCallDetail | Error = detail()) {
    api = jasmine.createSpyObj<MonitoringApiService>('MonitoringApiService', [
      'list',
      'get',
    ]);
    api.get.and.returnValue(
      response instanceof Error
        ? throwError(() => ({
            status: 404,
            error: { message: 'LLM call not found' },
          }))
        : of(response),
    );
    await TestBed.configureTestingModule({
      imports: [LlmCallDetailPage],
      providers: [{ provide: MonitoringApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(LlmCallDetailPage);
    fixture.componentRef.setInput('callId', 'call-1');
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const byId = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const text = (node: Element | null) =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('loads the call and titles it with the agent and model', async () => {
    await render();
    expect(api.get).toHaveBeenCalledWith('call-1');
    expect(text(el.querySelector('h2'))).toBe(
      'Questions to Insights Assistant · claude-opus-5-5',
    );
    const facts = new Map(
      Array.from(byId('llm-call-facts')!.querySelectorAll('dt')).map((dt) => [
        text(dt),
        text(dt.nextElementSibling),
      ]),
    );
    expect([...facts.keys()]).toEqual([
      'Started',
      'Duration',
      'Time to first token',
      'Status',
      'Run',
      'Provider',
      'Finish reason',
      'Tokens in',
      'Tokens out',
      'Estimated cost',
    ]);
    expect(facts.get('Duration')).toBe('17.3 s');
    expect(facts.get('Time to first token')).toBe('2.1 s');
    expect(facts.get('Provider')).toBe('anthropic.messages');
    expect(facts.get('Finish reason')).toBe('stop');
    expect(facts.get('Tokens in')).toBe(
      '61,185 cache read 40,000 · cache write 1,000',
    );
    expect(facts.get('Tokens out')).toBe('2,445 reasoning 300');
    expect(facts.get('Estimated cost')).toBe('$0.0213');
    expect(text(byId('llm-call-status'))).toBe('Succeeded');
  });

  it('titles a call without an agent "Model call"', async () => {
    await render(detail({ agent: null }));
    expect(text(el.querySelector('h2'))).toBe('Model call · claude-opus-5-5');
  });

  it('links a named session to its chat', async () => {
    await render();
    const opened: string[] = [];
    fixture.componentInstance.openSession.subscribe((id) => opened.push(id));
    const link = byId('llm-call-session-link')!;
    expect(text(link)).toBe('World Cup analysis');
    link.click();
    expect(opened).toEqual(['session-1']);
  });

  it("links a run's call to the run's flow, not to a chat", async () => {
    await render(
      detail({
        session: {
          id: 'run-r1',
          name: 'Assistant: Top scorers?',
          runId: 'r1',
        },
      }),
    );
    const chats: string[] = [];
    const runs: string[] = [];
    fixture.componentInstance.openSession.subscribe((id) => chats.push(id));
    fixture.componentInstance.openRun.subscribe((id) => runs.push(id));
    const link = byId('llm-call-session-link')!;
    expect(text(link)).toBe('Assistant: Top scorers?');
    link.click();
    expect(runs).toEqual(['run-r1']);
    expect(chats).toEqual([]);
  });

  it('shows an unnamed session as its short id, without a link', async () => {
    await render(detail({ session: { id: 'abcdef1234567890', name: null } }));
    expect(byId('llm-call-session-link')).toBeNull();
    expect(text(byId('llm-call-session'))).toBe('abcdef12');
  });

  it('shows the error of a failed call', async () => {
    await render(detail({ status: 'failed', error: 'Rate limited' }));
    expect(text(byId('llm-call-error'))).toBe('Rate limited');
    expect(byId('llm-call-status')!.classList).toContain('chip-danger');
  });

  it('shows the seven context boxes in order with their owners', async () => {
    await render();
    const boxIds = KEYS.map(([key]) => `context-segment-${key}`);
    const shown = Array.from(el.querySelectorAll('[data-testid]'))
      .map((node) => node.getAttribute('data-testid')!)
      .filter((id) => boxIds.includes(id));
    expect(shown).toEqual(boxIds);
    for (const [key, label, owner] of KEYS) {
      const box = byId(`context-segment-${key}`)!;
      expect(text(box)).toContain(label);
      expect(text(byId(`context-segment-owner-${key}`))).toBe(owner);
    }
    expect(text(byId('context-segment-system-prompt'))).toContain(
      '≈ 8,000 tokens · 45.3 %',
    );
    expect(text(byId('context-segment-system-prompt'))).toContain('2 items');
    expect(text(byId('context-segment-chat-history'))).toContain(
      'Nothing in this call.',
    );
    expect(byId('context-segment-toggle-chat-history')).toBeNull();
  });

  it('captions the context window against the model limit', async () => {
    await render();
    expect(text(byId('context-caption'))).toBe(
      '≈ 17,647 tokens of 1,000,000 (1.8 %)',
    );
  });

  it('captions without a limit when the model has none', async () => {
    await render(detail({ contextLimit: null }));
    expect(text(byId('context-caption'))).toBe('≈ 17,647 tokens');
  });

  it('draws one bar part per non-empty box with a tooltip', async () => {
    await render();
    const parts = Array.from(
      byId('context-bar')!.querySelectorAll('[data-testid^="context-bar-part-"]'),
    ) as HTMLElement[];
    expect(parts.map((p) => p.getAttribute('data-testid'))).toEqual([
      'context-bar-part-system-prompt',
      'context-bar-part-skills',
      'context-bar-part-tools',
      'context-bar-part-dataset',
      'context-bar-part-user-prompt',
    ]);
    expect(parts[0].getAttribute('title')).toBe(
      'System prompt: ≈ 8,000 tokens (45.3 %)',
    );
    expect(parts[0].style.width).toMatch(/^45\.3/);
    expect(parts[0].style.backgroundColor).toBe(
      'var(--qti-context-system-prompt)',
    );
  });

  it('shows and hides a box text with its toggle', async () => {
    await render();
    const toggle = byId('context-segment-toggle-user-prompt') as HTMLButtonElement;
    expect(text(toggle)).toBe('Show text');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(byId('context-segment-text-user-prompt')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    expect(text(toggle)).toBe('Hide text');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const shown = byId('context-segment-text-user-prompt')!;
    expect(text(shown)).toContain('User');
    expect(shown.querySelector('pre')!.textContent).toBe(
      'Which team performed best?',
    );

    toggle.click();
    fixture.detectChanges();
    expect(text(toggle)).toBe('Show text');
    expect(byId('context-segment-text-user-prompt')).toBeNull();
  });

  it('lists the steps', async () => {
    await render();
    const rows = Array.from(
      byId('llm-call-steps')!.querySelectorAll('tbody tr'),
    ).map((row) =>
      Array.from(row.querySelectorAll('td')).map((td) => text(td)),
    );
    expect(rows).toEqual([
      ['1', '15,000', '400', 'tool-calls', '4.0 s'],
      ['2', '17,647', '2,045', 'stop', '13.3 s'],
    ]);
  });

  it('shows the backend message when the call is not found', async () => {
    await render(new Error('missing'));
    const alert = byId('llm-call-load-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(text(alert)).toBe('LLM call not found');
  });
});
