import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  AgentDetail as AgentDetailModel,
  AgentEvalCaseResult,
  AgentEvalSet,
  AgentsApiService,
  EvalRunView,
} from '../../services/agents-api.service';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';
import { Datasource } from '../../../datasources/models/datasource.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { AgentDetail } from './agent-detail';

const ASSISTANT: AgentDetailModel = {
  key: 'assistant',
  id: 'assistant',
  name: 'Questions to Insights Assistant',
  description: 'Answers questions about your data',
  tools: [],
  kind: 'official',
  instructions: '',
  toolDetails: [],
  memory: null,
  model: null,
};

const WORLD_CUP: AgentEvalSet = {
  id: 'world-cup',
  name: 'World Cup',
  description: 'Questions against the bundled World Cup sample.',
  cases: [
    {
      id: 'champion-2022',
      question: 'Who won the 2022 World Cup?',
      intent: 'Single-hop lookup.',
      category: 'lookup',
      split: 'dev',
      checks: [
        {
          id: 'check-includes',
          name: 'includes',
          description: 'Checks if output includes "Argentina"',
        },
      ],
    },
    {
      id: 'out-of-scope',
      question: 'How many goals did Pelé score in the 1970 World Cup?',
      intent: 'Says it cannot answer.',
      category: 'out-of-scope',
      split: 'held-out',
      checks: [
        {
          id: 'llm-judge',
          name: 'llm-judge',
          description: 'LLM judge: says it cannot answer',
        },
      ],
    },
    {
      id: 'no-category',
      question: 'A question from an older file',
      intent: 'Has no category.',
      checks: [],
    },
  ],
};

const DATASOURCE = {
  id: 'ds-1',
  name: 'World Cup DB',
  kind: 'postgres',
  summary: '',
  config: {},
} as unknown as Datasource;

function result(over: Partial<AgentEvalCaseResult>): AgentEvalCaseResult {
  return {
    id: 'champion-2022',
    question: 'Who won the 2022 World Cup?',
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    passed: false,
    durationMs: 5,
    ...over,
  };
}

const NOT_SCORED_RESULT = result({
  id: 'out-of-scope',
  question: 'How many goals did Pelé score in the 1970 World Cup?',
  status: 'not-scored',
  category: 'out-of-scope',
  checkResults: [
    {
      id: 'llm-judge',
      description: 'LLM judge: says it cannot answer',
      score: 0,
      passed: false,
      status: 'not-scored',
      reason: 'Judge off for this run',
    },
  ],
});

const FINISHED_RUN: EvalRunView = {
  jobId: 'job-1',
  agentKey: 'assistant',
  datasourceId: 'ds-1',
  datasets: ['World Cup Core'],
  caseIds: ['champion-2022', 'out-of-scope'],
  status: 'completed',
  results: [
    result({ status: 'passed', passed: true, category: 'lookup' }),
    NOT_SCORED_RESULT,
  ],
  totalCases: 2,
  startedAt: '2026-10-13T10:00:00.000Z',
  finishedAt: '2026-10-13T10:00:04.000Z',
  judge: { mode: 'off' },
  summary: {
    passed: 1,
    failed: 0,
    notScored: 1,
    byCategory: [
      { category: 'lookup', passed: 1, failed: 0, notScored: 0, total: 1 },
      {
        category: 'out-of-scope',
        passed: 0,
        failed: 0,
        notScored: 1,
        total: 1,
      },
    ],
    byCriterion: [{ criterion: 'G1', passed: 1, failed: 0, total: 1 }],
  },
};

describe('AgentDetail evals', () => {
  let fixture: ComponentFixture<AgentDetail>;
  let api: jasmine.SpyObj<AgentsApiService>;
  let el: HTMLElement;

  beforeEach(async () => {
    api = jasmine.createSpyObj<AgentsApiService>('AgentsApiService', [
      'getAgent',
      'getAgentEvals',
      'startEvalRun',
      'getEvalRun',
      'listEvalRuns',
      'skills',
    ]);
    api.getAgent.and.returnValue(of(ASSISTANT));
    api.skills.and.returnValue(of({ skills: [] }));
    api.getAgentEvals.and.returnValue(of({ sets: [WORLD_CUP] }));
    api.startEvalRun.and.returnValue(
      of({ ok: true, message: 'Eval run started', jobId: 'job-1' }),
    );
    api.getEvalRun.and.returnValue(
      of({ ok: true, message: '', ...FINISHED_RUN }),
    );
    api.listEvalRuns.and.returnValue(of({ runs: [FINISHED_RUN] }));

    await TestBed.configureTestingModule({
      imports: [AgentDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AgentsApiService, useValue: api },
        {
          provide: DatasourcesApiService,
          useValue: { list: () => of({ datasources: [DATASOURCE] }) },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error']),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentDetail);
    fixture.componentRef.setInput('agentKey', 'assistant');
    fixture.detectChanges();
    fixture.componentInstance.activeTab.set('evals');
    fixture.detectChanges();
    fixture.componentInstance.selectSet('world-cup');
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  const byTestId = (id: string) =>
    el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('shows each question’s category as a chip, and none without one', () => {
    expect(
      byTestId('eval-case-category-champion-2022')?.textContent?.trim(),
    ).toBe('lookup');
    expect(
      byTestId('eval-case-category-out-of-scope')?.textContent?.trim(),
    ).toBe('out-of-scope');
    expect(byTestId('eval-case-category-no-category')).toBeNull();
  });

  it('offers a labelled Judge select, Off by default', () => {
    const select = byTestId('eval-judge') as HTMLSelectElement;
    expect(select.value).toBe('off');
    expect([...select.options].map((o) => [o.value, o.text.trim()])).toEqual([
      ['off', 'Off'],
      ['on', 'On'],
    ]);
    const label = el.querySelector<HTMLLabelElement>('label[for="eval-judge"]');
    expect(label?.textContent?.trim()).toBe('Judge');
    expect(select.id).toBe('eval-judge');
  });

  it('starts the run with the judge off by default', () => {
    byTestId('eval-run')!.click();
    expect(api.startEvalRun).toHaveBeenCalledOnceWith(
      'assistant',
      'ds-1',
      ['champion-2022', 'out-of-scope', 'no-category'],
      'off',
      1,
    );
  });

  it('sends the judge choice with the run', () => {
    const select = byTestId('eval-judge') as HTMLSelectElement;
    select.value = 'on';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    byTestId('eval-run')!.click();
    expect(api.startEvalRun.calls.mostRecent().args[3]).toBe('on');
  });

  it('offers a labelled Repeats select reading 1, with 1, 3 and 5', () => {
    const select = byTestId('eval-repeats') as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect([...select.options].map((o) => [o.value, o.text.trim()])).toEqual([
      ['1', '1'],
      ['3', '3'],
      ['5', '5'],
    ]);
    const label = el.querySelector<HTMLLabelElement>(
      'label[for="eval-repeats"]',
    );
    expect(label?.textContent?.trim()).toBe('Repeats');
  });

  it('sends the repeats with the run and keeps them across sets', () => {
    const select = byTestId('eval-repeats') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    fixture.componentInstance.selectSet('world-cup');
    fixture.componentInstance.selectSet('world-cup');
    fixture.detectChanges();
    expect((byTestId('eval-repeats') as HTMLSelectElement).value).toBe('3');

    byTestId('eval-run')!.click();
    expect(api.startEvalRun.calls.mostRecent().args[4]).toBe(3);
  });

  it('disables Repeats while a run is in flight and shows its attempt', () => {
    api.getEvalRun.and.returnValue(
      of({
        ok: true,
        message: '',
        ...FINISHED_RUN,
        status: 'running',
        repeats: 3,
        currentAttempt: 2,
        results: [],
      }),
    );
    const select = byTestId('eval-repeats') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    byTestId('eval-run')!.click();
    fixture.detectChanges();

    expect((byTestId('eval-repeats') as HTMLSelectElement).disabled).toBeTrue();
    expect(el.textContent).toContain('· attempt 2/3');
    fixture.destroy();
  });

  it('marks a held-out question with a chip, and a dev one with none', () => {
    expect(byTestId('eval-split-out-of-scope')?.textContent?.trim()).toBe(
      'held-out',
    );
    expect(byTestId('eval-split-champion-2022')).toBeNull();
    expect(byTestId('eval-split-no-category')).toBeNull();
  });

  it('shows no repeat, flaky or cost on a run saved before them', () => {
    fixture.componentInstance.selectEvalTab('runs');
    fixture.detectChanges();
    expect(byTestId('eval-run-repeats-job-1')).toBeNull();
    expect(byTestId('eval-run-flaky-job-1')).toBeNull();
    expect(byTestId('eval-run-cost-job-1')).toBeNull();
  });

  it('shows repeats, flaky, cost, the split line and held-out chips', () => {
    const attempt = (n: number, passed: boolean) => ({
      attempt: n,
      status: passed ? ('passed' as const) : ('failed' as const),
      passed,
      scores: {},
      checkResults: [],
      answer: '',
      toolCalls: [],
      durationMs: 5,
      usage: [],
      costUsd: 0.001,
    });
    const run: EvalRunView = {
      ...FINISHED_RUN,
      repeats: 3,
      costUsd: 0.0123,
      results: [
        result({
          id: 'out-of-scope',
          split: 'held-out',
          status: 'failed',
          flaky: true,
          passes: 2,
          runs: 3,
          attempts: [attempt(1, true), attempt(2, true), attempt(3, false)],
        }),
      ],
      summary: {
        passed: 0,
        failed: 1,
        notScored: 0,
        flaky: 1,
        bySplit: {
          dev: { passed: 0, failed: 0, notScored: 0, flaky: 0, total: 0 },
          heldOut: {
            passed: 0,
            failed: 1,
            notScored: 0,
            flaky: 1,
            total: 1,
            interval: { low: 0, high: 0.79 },
          },
        },
        byCategory: [
          {
            category: 'out-of-scope',
            passed: 0,
            failed: 1,
            notScored: 0,
            flaky: 1,
            total: 1,
            dev: { passed: 0, failed: 0, notScored: 0, flaky: 0, total: 0 },
            heldOut: {
              passed: 0,
              failed: 1,
              notScored: 0,
              flaky: 1,
              total: 1,
              interval: { low: 0, high: 0.79 },
            },
          },
        ],
        byCriterion: [],
      },
    };
    api.listEvalRuns.and.returnValue(of({ runs: [run] }));
    fixture.componentInstance.selectEvalTab('runs');
    fixture.detectChanges();

    expect(byTestId('eval-run-repeats-job-1')?.textContent?.trim()).toBe(
      'Repeat 3',
    );
    expect(byTestId('eval-run-flaky-job-1')?.textContent?.trim()).toBe(
      '1 flaky',
    );
    expect(byTestId('eval-run-cost-job-1')?.textContent?.trim()).toBe(
      '$0.0123',
    );

    byTestId('eval-run-job-1')!
      .querySelector<HTMLButtonElement>('[aria-expanded]')!
      .click();
    fixture.detectChanges();

    expect(byTestId('eval-run-splits-job-1')?.textContent?.trim()).toBe(
      'Dev — · Held-out 0/1 (0–79%)',
    );
    expect(
      [
        ...byTestId('eval-run-summary-category-out-of-scope')!.querySelectorAll(
          'th, td',
        ),
      ].map((c) => c.textContent?.trim()),
    ).toEqual(['out-of-scope', '—', '0/1 (0–79%)', '1', '0', '1']);
    expect(
      byTestId('eval-run-result-split-job-1-out-of-scope')?.textContent?.trim(),
    ).toBe('held-out');
    expect(
      byTestId('eval-run-result-job-1-out-of-scope')?.textContent,
    ).toContain('2/3');
  });

  it('says Not priced, with the models, on an unpriced run', () => {
    const run: EvalRunView = {
      ...FINISHED_RUN,
      costUsd: null,
      usage: [
        {
          agent: 'assistant',
          model: 'acme-1',
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 5,
          reasoningTokens: 0,
          calls: 1,
          unreportedCalls: 0,
        },
      ],
    };
    api.listEvalRuns.and.returnValue(of({ runs: [run] }));
    fixture.componentInstance.selectEvalTab('runs');
    fixture.detectChanges();
    const cost = byTestId('eval-run-cost-job-1')!;
    expect(cost.textContent?.trim()).toBe('Not priced');
    expect(cost.getAttribute('title')).toBe('No price for acme-1');
  });

  it('shows a not-scored question and check as "Not scored"', () => {
    byTestId('eval-run')!.click();
    fixture.detectChanges();

    const verdict = byTestId('eval-result-out-of-scope');
    expect(verdict?.textContent?.trim()).toBe('Not scored');
    expect(byTestId('eval-case-out-of-scope')?.textContent).toContain(
      'Not scored',
    );
    expect(byTestId('eval-result-champion-2022')?.textContent?.trim()).toBe(
      'passed',
    );
    // The progress line counts it.
    expect(el.textContent).toContain('1 not scored');
  });

  it('shows the headline and the summary of a finished run in Executions', () => {
    fixture.componentInstance.selectEvalTab('runs');
    fixture.detectChanges();

    const card = byTestId('eval-run-job-1');
    expect(card?.textContent).toContain('1/2 passed · 1 not scored');
    // The summary is part of the expanded run.
    expect(byTestId('eval-run-summary-job-1')).toBeNull();

    const toggle = card!.querySelector<HTMLButtonElement>('[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(byTestId('eval-run-summary-job-1')).not.toBeNull();
    expect(
      byTestId('eval-run-summary-category-out-of-scope')?.textContent,
    ).toContain('out-of-scope');
    expect(byTestId('eval-run-summary-criterion-G1')).not.toBeNull();
    expect(
      byTestId('eval-run-result-job-1-out-of-scope')?.textContent,
    ).toContain('Not scored');
  });

  it('keeps a listed run current while it goes (R152)', () => {
    const going: EvalRunView = {
      ...FINISHED_RUN,
      status: 'running',
      results: [],
      summary: undefined,
    };
    api.listEvalRuns.and.returnValue(of({ runs: [going] }));
    fixture.componentInstance.selectEvalTab('runs');
    fixture.detectChanges();
    expect(byTestId('eval-run-job-1')?.textContent).toContain('0/2 passed');

    // The next poll has one finished question and its summary.
    api.getEvalRun.and.returnValue(
      of({
        ok: true,
        message: '',
        ...FINISHED_RUN,
        status: 'running',
        results: [FINISHED_RUN.results[0]],
      }),
    );
    fixture.componentInstance.startRun();
    fixture.detectChanges();

    const card = byTestId('eval-run-job-1')!;
    expect(card.textContent).toContain('1/2 passed');
    card.querySelector<HTMLButtonElement>('[aria-expanded]')!.click();
    fixture.detectChanges();
    expect(byTestId('eval-run-summary-job-1')).not.toBeNull();
    // Stop polling.
    fixture.destroy();
  });
});
