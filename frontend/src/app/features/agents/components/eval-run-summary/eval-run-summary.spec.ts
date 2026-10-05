import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AgentEvalCaseResult, EvalRunView } from '../../models/eval.model';
import { EvalRunSummary } from './eval-run-summary';

function run(overrides: Partial<EvalRunView> = {}): EvalRunView {
  return {
    jobId: 'job-1',
    agentKey: 'assistant',
    suiteId: 'health-insurance',
    suiteName: 'Health Insurance',
    datasourceId: 'ds-1',
    datasets: ['claims'],
    caseIds: ['a', 'b'],
    status: 'completed',
    results: [],
    totalCases: 2,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function evalResult(
  id: string,
  overrides: Partial<AgentEvalCaseResult> = {},
): AgentEvalCaseResult {
  return {
    id,
    question: `Question ${id}?`,
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    passed: true,
    durationMs: 100,
    ...overrides,
  };
}

describe('EvalRunSummary', () => {
  let fixture: ComponentFixture<EvalRunSummary>;
  let component: EvalRunSummary;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EvalRunSummary],
    }).compileComponents();
    fixture = TestBed.createComponent(EvalRunSummary);
    component = fixture.componentInstance;
  });

  describe('a v2 run (with `summary`)', () => {
    beforeEach(() => {
      fixture.componentRef.setInput(
        'run',
        run({
          repeat: 3,
          arm: 'fixer-off',
          model: 'openai/gpt-5',
          reasoningEffort: 'high',
          judgeModel: 'openai/gpt-4.1-mini',
          configHash: 'abc123def456',
          usage: {
            inputTokens: 30_000,
            outputTokens: 11_200,
            totalTokens: 41_200,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            calls: 12,
          },
          summary: {
            passK: 12,
            passKRate: 0.63,
            scored: 19,
            meanPassRate: 0.7,
            flaky: 2,
            gaps: 1,
            answeredEveryTime: 19,
            answeredObserved: 19,
            byCategory: {
              'ratio-trap': { total: 3, passK: 0, meanPassRate: 0.2 },
              control: { total: 3, passK: 3, meanPassRate: 1 },
            },
            byDifficulty: {
              hard: { total: 4, passK: 1 },
              easy: { total: 4, passK: 4 },
            },
            costPerCorrectUsd: 0.0421,
          },
        }),
      );
    });

    it('builds the pass^k headline from `formatPassK`', () => {
      expect(component.headline()).toBe('12/19 pass^3 · 63% · 1 gap');
    });

    it('reads the mean pass rate and cost-per-correct label', () => {
      expect(component.meanRateLabel()).toBe('70%');
      expect(component.costLabel()).toContain('per correct answer');
      expect(component.answeredLabel()).toBe('answered 19/19');
    });

    it('builds arm/model/effort/judge/config chips', () => {
      expect(component.chips()).toEqual([
        { label: 'arm', value: 'fixer-off' },
        { label: 'model', value: 'openai/gpt-5' },
        { label: 'effort', value: 'high' },
        { label: 'judge', value: 'openai/gpt-4.1-mini' },
        { label: 'config', value: 'abc123def456' },
      ]);
    });

    it('maps byCategory to worst-first pass^k rates', () => {
      const rates = component.categoryPassKRates();
      expect(rates.map((r) => r.category)).toEqual(['ratio-trap', 'control']);
      expect(rates[0]).toEqual(
        jasmine.objectContaining({ total: 3, passed: 0, rate: 0 }),
      );
    });

    it('maps byDifficulty to worst-first pass^k rates', () => {
      const rates = component.difficultyPassKRates();
      expect(rates.map((r) => r.category)).toEqual(['hard', 'easy']);
    });
  });

  describe('a legacy run (no `summary`)', () => {
    beforeEach(() => {
      fixture.componentRef.setInput(
        'run',
        run({
          categories: {
            ties: { total: 2, passed: 2 },
            'value-vocabulary': { total: 4, passed: 1 },
          },
        }),
      );
    });

    it('has no pass^k headline to show', () => {
      expect(component.headline()).toBe('');
      expect(component.summary()).toBeUndefined();
    });

    it('falls back to the pre-v2 pass-rate-by-category table', () => {
      const rates = component.legacyCategoryRates();
      expect(rates.map((r) => r.category)).toEqual([
        'value-vocabulary',
        'ties',
      ]);
    });

    it('still shows an arm chip, defaulting to baseline', () => {
      expect(component.chips()).toEqual([{ label: 'arm', value: 'baseline' }]);
    });
  });

  describe('per-question verdict badge', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('run', run());
    });

    it('renders GAP neutrally with an explanatory tooltip', () => {
      const result = evalResult('a', { verdict: 'GAP', passed: false });
      expect(component.resultVerdict(result)).toBe('GAP');
      expect(component.resultVerdictClass(result)).toBe('text-slate-400');
      expect(component.resultVerdictTooltip(result)).toBe(
        'the harness could not measure this — not counted',
      );
    });

    it('appends passes/runs once the case ran more than once', () => {
      const result = evalResult('a', {
        verdict: 'FAIL',
        passed: false,
        runs: 3,
        passes: 2,
      });
      expect(component.resultPassesRunsSuffix(result)).toBe(' 2/3');
    });

    it('omits the passes/runs suffix for a single-attempt case', () => {
      const result = evalResult('a', { verdict: 'PASS', runs: 1, passes: 1 });
      expect(component.resultPassesRunsSuffix(result)).toBe('');
    });

    it('emits the clicked result through `selectResult`', () => {
      const result = evalResult('a');
      const spy = jasmine.createSpy('selectResult');
      component.selectResult.subscribe(spy);
      component.selectResult.emit(result);
      expect(spy).toHaveBeenCalledWith(result);
    });
  });
});
