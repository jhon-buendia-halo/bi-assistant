import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { MonitoringStateService } from '../../services/monitoring-state.service';
import {
  LlmCallPage,
  LlmCallQuery,
  LlmCallRow,
} from '../../models/llm-call.model';
import { LlmCallsPage } from './llm-calls-page';

function llmCallRow(
  id: string,
  extra: Partial<LlmCallRow> = {},
): LlmCallRow {
  return {
    id,
    traceId: `trace-${id}`,
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
    ...extra,
  };
}

function page(items: LlmCallRow[], extra: Partial<LlmCallPage> = {}): LlmCallPage {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
    facets: {
      agents: [
        { id: 'assistant', name: 'Questions to Insights Assistant' },
        { id: 'visualization', name: 'Visual Designer' },
      ],
      models: ['claude-haiku-4-5', 'claude-opus-5-5'],
      providers: ['anthropic.messages'],
      sessions: [
        { id: 'abcdef1234567890', name: null },
        { id: 'session-1', name: 'World Cup analysis' },
      ],
    },
    ...extra,
  };
}

describe('LlmCallsPage', () => {
  let fixture: ComponentFixture<LlmCallsPage>;
  let api: jasmine.SpyObj<MonitoringApiService>;
  let state: MonitoringStateService;
  let el: HTMLElement;

  async function render(
    response: LlmCallPage | Error = page([llmCallRow('call-1')]),
  ): Promise<void> {
    api = jasmine.createSpyObj<MonitoringApiService>('MonitoringApiService', [
      'list',
      'get',
    ]);
    api.list.and.returnValue(
      response instanceof Error
        ? throwError(() => ({ status: 500, error: { message: 'down' } }))
        : of(response),
    );
    await TestBed.configureTestingModule({
      imports: [LlmCallsPage],
      providers: [{ provide: MonitoringApiService, useValue: api }],
    }).compileComponents();
    state = TestBed.inject(MonitoringStateService);
    fixture = TestBed.createComponent(LlmCallsPage);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const byId = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const lastQuery = (): LlmCallQuery => api.list.calls.mostRecent().args[0];
  const optionTexts = (id: string) =>
    Array.from(byId(id)!.querySelectorAll('option')).map((o) =>
      o.textContent!.trim(),
    );

  async function choose(id: string, value: string): Promise<void> {
    const select = byId(id) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  it('renders a row per call with its columns', async () => {
    await render();
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25 });
    const row = byId('llm-call-row-call-1')!;
    const cells = Array.from(row.querySelectorAll('td')).map((td) =>
      td.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(cells[1]).toBe('Questions to Insights Assistant');
    const model = Array.from(row.querySelectorAll('td')[2].querySelectorAll('div'));
    expect(model.map((d) => d.textContent!.trim())).toEqual([
      'claude-opus-5-5',
      'anthropic.messages',
    ]);
    expect(cells[3]).toBe('World Cup analysis');
    expect(cells[4]).toBe('61,185 / 2,445');
    expect(cells[5]).toBe('17.3 s');
    expect(cells[6]).toBe('$0.0213');
    expect(cells[7]).toBe('Succeeded');
    expect(byId('llm-call-status-call-1')!.classList).toContain('chip-success');
  });

  it('shows "—" for an unpriced call, a failed chip and a short id for an unnamed session', async () => {
    await render(
      page([
        llmCallRow('call-2', {
          costUsd: null,
          status: 'failed',
          agent: null,
          session: { id: 'abcdef1234567890', name: null },
        }),
        llmCallRow('call-3', { status: 'running' }),
      ]),
    );
    const cells = Array.from(
      byId('llm-call-row-call-2')!.querySelectorAll('td'),
    ).map((td) => td.textContent!.trim());
    expect(cells[1]).toBe('—');
    expect(cells[3]).toBe('abcdef12');
    expect(cells[6]).toBe('—');
    expect(byId('llm-call-status-call-2')!.classList).toContain('chip-danger');
    expect(byId('llm-call-status-call-3')!.textContent!.trim()).toBe('Running');
    expect(byId('llm-call-status-call-3')!.classList).toContain('chip-neutral');
  });

  it('opens a call on click and on Enter', async () => {
    await render();
    const opened: string[] = [];
    fixture.componentInstance.openCall.subscribe((id) => opened.push(id));
    const row = byId('llm-call-row-call-1')!;
    row.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(opened).toEqual(['call-1', 'call-1']);
  });

  it('offers the facets in the selects', async () => {
    await render();
    expect(optionTexts('llm-filter-agent')).toEqual([
      'All agents',
      'Questions to Insights Assistant',
      'Visual Designer',
    ]);
    expect(optionTexts('llm-filter-model')).toEqual([
      'All models',
      'claude-haiku-4-5',
      'claude-opus-5-5',
    ]);
    expect(optionTexts('llm-filter-provider')).toEqual([
      'All providers',
      'anthropic.messages',
    ]);
    expect(optionTexts('llm-filter-status')).toEqual([
      'Any status',
      'Succeeded',
      'Failed',
      'Running',
    ]);
    expect(optionTexts('llm-filter-session')).toEqual([
      'All sessions',
      'abcdef12',
      'World Cup analysis',
    ]);
    expect(optionTexts('llm-filter-range')).toEqual([
      'Any time',
      'Last hour',
      'Last 24 hours',
      'Last 7 days',
      'Custom',
    ]);
  });

  it('filters, going back to page 1, and Clear filters resets them', async () => {
    await render(page([llmCallRow('call-1')], { total: 120 }));
    expect((byId('llm-filters-clear') as HTMLButtonElement).disabled).toBeTrue();
    state.setPage(3);
    await settle();
    await choose('llm-filter-agent', 'assistant');
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25, agent: 'assistant' });
    await choose('llm-filter-status', 'failed');
    expect(lastQuery()).toEqual({
      page: 1,
      pageSize: 25,
      agent: 'assistant',
      status: 'failed',
    });
    const clear = byId('llm-filters-clear') as HTMLButtonElement;
    expect(clear.disabled).toBeFalse();
    clear.click();
    await settle();
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25 });
    expect(clear.disabled).toBeTrue();
    expect((byId('llm-filter-agent') as HTMLSelectElement).value).toBe('');
  });

  it('shows From and To only for a custom range', async () => {
    await render();
    expect(byId('llm-filter-from')).toBeNull();
    await choose('llm-filter-range', 'custom');
    expect(byId('llm-filter-from')).not.toBeNull();
    expect(byId('llm-filter-to')).not.toBeNull();
    const from = byId('llm-filter-from') as HTMLInputElement;
    from.value = '2026-11-01T10:00';
    from.dispatchEvent(new Event('change'));
    await settle();
    expect(lastQuery().from).toBe(new Date('2026-11-01T10:00').toISOString());
  });

  it('pages with a summary, Previous / Next and the page size', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => llmCallRow(`c${i}`));
    await render(page(rows, { total: 132 }));
    expect(byId('llm-page-summary')!.textContent!.trim()).toBe('1–25 of 132');
    expect((byId('llm-page-prev') as HTMLButtonElement).disabled).toBeTrue();
    expect((byId('llm-page-next') as HTMLButtonElement).disabled).toBeFalse();

    byId('llm-page-next')!.click();
    await settle();
    expect(lastQuery()).toEqual({ page: 2, pageSize: 25 });
    expect(byId('llm-page-summary')!.textContent!.trim()).toBe('26–50 of 132');
    expect((byId('llm-page-prev') as HTMLButtonElement).disabled).toBeFalse();

    await choose('llm-page-size', '100');
    expect(lastQuery()).toEqual({ page: 1, pageSize: 100 });
    expect(optionTexts('llm-page-size')).toEqual(['25', '50', '100']);
  });

  it('disables Next on the last page', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => llmCallRow(`c${i}`));
    await render(page(rows, { total: 32 }));
    state.setPage(2);
    await settle();
    expect(byId('llm-page-summary')!.textContent!.trim()).toBe('26–32 of 32');
    expect((byId('llm-page-next') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('says "No LLM calls yet." when there are none', async () => {
    await render(page([]));
    expect(byId('llm-calls-empty')!.textContent!.trim()).toBe('No LLM calls yet.');
    expect(byId('llm-calls-table')).toBeNull();
    expect(byId('llm-page-summary')).toBeNull();
  });

  it('says "No LLM calls match these filters." when filters hide every call', async () => {
    await render(page([]));
    await choose('llm-filter-status', 'running');
    expect(byId('llm-calls-empty')!.textContent!.trim()).toBe(
      'No LLM calls match these filters.',
    );
  });

  it('shows an inline error when the calls cannot be loaded', async () => {
    await render(new Error('down'));
    const alert = byId('llm-calls-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent!.trim()).toBe('Could not load LLM calls: down');
  });

  it('keeps the filters it was left with', async () => {
    await render();
    await choose('llm-filter-model', 'claude-opus-5-5');
    fixture.destroy();
    fixture = TestBed.createComponent(LlmCallsPage);
    el = fixture.nativeElement as HTMLElement;
    await settle();
    expect((byId('llm-filter-model') as HTMLSelectElement).value).toBe(
      'claude-opus-5-5',
    );
    expect(lastQuery()).toEqual({
      page: 1,
      pageSize: 25,
      model: 'claude-opus-5-5',
    });
  });
});
