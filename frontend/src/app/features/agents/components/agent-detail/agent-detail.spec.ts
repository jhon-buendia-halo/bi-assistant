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
import { AuthService } from '../../../../core/auth/auth.service';
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
    ]);
    api.getAgent.and.returnValue(of(ASSISTANT));
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
        { provide: AgentsApiService, useValue: api },
        {
          provide: DatasourcesApiService,
          useValue: { list: () => of({ datasources: [DATASOURCE] }) },
        },
        { provide: AuthService, useValue: { can: () => true } },
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

  it('keeps a listed run current while it goes (R151)', () => {
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
