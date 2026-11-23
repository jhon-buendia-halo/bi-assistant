import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  AgentQualityPage as QualityPageData,
  AgentQualityRow,
  QualityQuery,
} from '../../models/agent-quality.model';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { MonitoringStateService } from '../../services/monitoring-state.service';
import { AgentQualityPage } from './agent-quality-page';

function row(
  key: string,
  extra: Partial<AgentQualityRow> = {},
): AgentQualityRow {
  return {
    agentKey: key,
    agentId: key,
    name: 'Insights Analyst',
    role: 'Data analyst',
    eval: {
      state: 'ok',
      model: 'gpt-4o-mini',
      provider: 'openai',
      runs: 3,
      lastRun: {
        jobId: 'job-1',
        at: new Date(2026, 10, 21, 12).toISOString(),
        passed: 9,
        total: 10,
      },
      pass3: { state: 'ok', value: 0.5, cases: 8, totalCases: 10 },
      questions: 30,
      toolCalls: 75,
      toolCallsPerQuestion: 2.5,
      toolErrorRate: 0.04,
    },
    live: { calls: 12, p95Ms: 17300, pricedCalls: 12, costPerCallUsd: 0.0213 },
    ...extra,
  };
}

function page(rows: AgentQualityRow[]): QualityPageData {
  return {
    from: null,
    to: '2026-11-22T10:00:00.000Z',
    rows,
    facets: {
      agents: [
        { key: 'assistant', name: 'Insights Analyst' },
        { key: 'visualization', name: 'Visual Designer' },
      ],
      sets: [
        { id: 'a1', name: 'Core', agentKey: 'assistant' },
        { id: 'v1', name: 'Charts', agentKey: 'visualization' },
      ],
      models: ['gpt-4o-mini', 'Unknown'],
    },
  };
}

describe('AgentQualityPage', () => {
  let fixture: ComponentFixture<AgentQualityPage>;
  let api: jasmine.SpyObj<MonitoringApiService>;
  let state: MonitoringStateService;
  let el: HTMLElement;

  async function render(
    response: QualityPageData | Error = page([row('assistant')]),
  ): Promise<void> {
    api = jasmine.createSpyObj<MonitoringApiService>('MonitoringApiService', [
      'getAgentQuality',
    ]);
    api.getAgentQuality.and.returnValue(
      response instanceof Error
        ? throwError(() => ({
            status: 400,
            error: { message: 'From is not a valid date' },
          }))
        : of(response),
    );
    await TestBed.configureTestingModule({
      imports: [AgentQualityPage],
      providers: [{ provide: MonitoringApiService, useValue: api }],
    }).compileComponents();
    state = TestBed.inject(MonitoringStateService);
    fixture = TestBed.createComponent(AgentQualityPage);
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
  const text = (id: string) =>
    byId(id)!.textContent!.replace(/\s+/g, ' ').trim();
  const lastQuery = (): QualityQuery =>
    api.getAgentQuality.calls.mostRecent().args[0];
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

  beforeEach(() => {
    localStorage.clear();
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it('renders the columns of a row', async () => {
    await render();
    expect(byId('agent-quality-row-assistant')!.textContent).toContain(
      'Data analyst',
    );
    expect(text('agent-quality-pass-assistant')).toBe('9/10 · 90%');
    expect(
      byId('agent-quality-pass-assistant')!.querySelector('.chip-warning'),
    ).not.toBeNull();
    expect(text('agent-quality-pass3-assistant')).toBe('50%(8 of 10)');
    expect(text('agent-quality-tools-assistant')).toBe('2.5');
    expect(text('agent-quality-tool-errors-assistant')).toBe('4.0 %');
    expect(text('agent-quality-p95-assistant')).toBe('17.3 s');
    expect(text('agent-quality-cost-assistant')).toBe('$0.0213');
    expect(text('agent-quality-last-assistant')).toBe('Nov 21');
    expect(text('agent-quality-legend')).toContain(
      'Choose a row to open its eval executions.',
    );
  });

  it('asks for the last 30 days by default', async () => {
    await render();
    const query = lastQuery();
    expect(query.from).toBeDefined();
    expect(query.agent).toBeUndefined();
    expect(optionTexts('quality-filter-range')).toEqual([
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
      'All time',
    ]);
  });

  it('shows the no-run states', async () => {
    await render(
      page([
        row('a', {
          eval: {
            ...row('a').eval,
            state: 'none',
            lastRun: null,
            pass3: null,
            toolCallsPerQuestion: null,
            toolErrorRate: null,
          },
          live: { calls: 0, p95Ms: null, pricedCalls: 0, costPerCallUsd: null },
        }),
        row('b', {
          eval: {
            ...row('b').eval,
            state: 'no-match',
            lastRun: null,
            pass3: null,
            toolCallsPerQuestion: null,
            toolErrorRate: null,
          },
        }),
      ]),
    );
    expect(text('agent-quality-pass-a')).toBe('No eval run yet');
    expect(text('agent-quality-pass-b')).toBe(
      'No eval run matches these filters',
    );
    expect(text('agent-quality-pass3-a')).toBe('—');
    expect(text('agent-quality-tools-a')).toBe('—');
    expect(text('agent-quality-tool-errors-a')).toBe('—');
    expect(text('agent-quality-last-a')).toBe('—');
    expect(text('agent-quality-p95-a')).toBe('—');
    expect(byId('agent-quality-p95-a')!.title).toBe(
      'No live calls in this period',
    );
    expect(text('agent-quality-cost-a')).toBe('—');
  });

  it('shows the pass^3 states and tones', async () => {
    const base = row('x').eval;
    await render(
      page([
        row('full', {
          eval: {
            ...base,
            pass3: { state: 'ok', value: 1, cases: 10, totalCases: 10 },
          },
        }),
        row('low', {
          eval: {
            ...base,
            pass3: { state: 'ok', value: 0.4, cases: 5, totalCases: 5 },
          },
        }),
        row('needs', {
          eval: { ...base, pass3: { state: 'needs-runs', runs: 1 } },
        }),
        row('unk', { eval: { ...base, pass3: { state: 'unknown-model' } } }),
      ]),
    );
    const cell = (k: string) => byId(`agent-quality-pass3-${k}`)!;
    expect(cell('full').textContent!.trim()).toBe('100%');
    expect(cell('full').querySelector('.chip-success')).not.toBeNull();
    expect(cell('full').textContent).not.toContain(' of ');
    expect(cell('low').querySelector('.chip-danger')).not.toBeNull();
    expect(text('agent-quality-pass3-needs')).toBe('needs 3 runs (1 of 3)');
    expect(text('agent-quality-pass3-unk')).toBe('—');
    expect(cell('unk').querySelector('span')!.title).toBe(
      'Model not recorded for these runs',
    );
  });

  it('shows the loading, empty and error states', async () => {
    await render(page([]));
    expect(text('monitoring-quality-empty')).toBe(
      'No agent persona matches these filters.',
    );
    TestBed.resetTestingModule();
    await render(new Error('x'));
    expect(text('monitoring-quality-error')).toBe(
      'Could not load agent quality: From is not a valid date',
    );
    expect(byId('monitoring-quality-loading')).toBeNull();
  });

  it('narrows the set options to the chosen agent and clears the set', async () => {
    await render();
    expect(optionTexts('quality-filter-set')).toEqual([
      'All sets',
      'Core',
      'Charts',
    ]);
    await choose('quality-filter-set', 'a1');
    expect(lastQuery().set).toBe('a1');
    await choose('quality-filter-agent', 'visualization');
    expect(optionTexts('quality-filter-set')).toEqual(['All sets', 'Charts']);
    expect(lastQuery().agent).toBe('visualization');
    expect(lastQuery().set).toBeUndefined();
  });

  it('filters by model and resets with Clear filters', async () => {
    await render();
    const clear = byId('quality-filters-clear') as HTMLButtonElement;
    expect(clear.disabled).toBeTrue();
    await choose('quality-filter-model', 'Unknown');
    expect(lastQuery().model).toBe('Unknown');
    await choose('quality-filter-range', 'any');
    expect(lastQuery().from).toBeUndefined();
    expect(clear.disabled).toBeFalse();
    clear.click();
    await settle();
    expect(state.hasQualityFilters()).toBeFalse();
    expect(lastQuery().model).toBeUndefined();
    expect(lastQuery().from).toBeDefined();
  });

  it('emits the key on a click and on Enter', async () => {
    await render();
    const keys: string[] = [];
    fixture.componentInstance.openAgent.subscribe((k) => keys.push(k));
    const tr = byId('agent-quality-row-assistant')!;
    tr.click();
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(keys).toEqual(['assistant', 'assistant']);
  });
});
