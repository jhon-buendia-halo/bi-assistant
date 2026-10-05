import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AgentEvalCase,
  AgentEvalCaseResult,
  AgentEvalSet,
  EvalRunView,
  TokenUsage,
} from '../../models/eval.model';
import { AgentDetail } from './agent-detail';

function evalCase(id: string, category: string): AgentEvalCase {
  return {
    id,
    category,
    question: `Question ${id}?`,
    intent: `Probes ${category}`,
    checks: [],
  };
}

function evalSet(
  id: string,
  cases: AgentEvalCase[],
  overrides: Partial<AgentEvalSet> = {},
): AgentEvalSet {
  return {
    id,
    name: id,
    description: `Questions about ${id}.`,
    datasets: [id],
    cases,
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

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 30_000,
    outputTokens: 11_200,
    totalTokens: 41_200,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    calls: 12,
    ...overrides,
  };
}

function run(overrides: Partial<EvalRunView> = {}): EvalRunView {
  return {
    jobId: 'job-1',
    agentKey: 'assistant',
    suiteId: 'health-insurance',
    suiteName: 'Health Insurance',
    datasourceId: 'ds-1',
    datasets: ['claims'],
    caseIds: ['a'],
    status: 'completed',
    results: [],
    totalCases: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AgentDetail evals tab', () => {
  let fixture: ComponentFixture<AgentDetail>;
  let component: AgentDetail;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentDetail],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    // Deliberately not detecting changes: the component's effects would fire
    // HTTP loads, and these tests exercise the pure selection/telemetry logic
    // against signals set by hand.
    fixture = TestBed.createComponent(AgentDetail);
    component = fixture.componentInstance;
  });

  describe('category filter', () => {
    beforeEach(() => {
      component.evalSets.set([
        evalSet('demo', [
          evalCase('a', 'ties'),
          evalCase('b', 'ambiguity'),
          evalCase('c', 'ties'),
        ]),
      ]);
      component.selectSet('demo');
    });

    it('ticks every question of a set when it is opened', () => {
      expect([...component.selectedCaseIds()]).toEqual(['a', 'b', 'c']);
    });

    it('lists each category once with its case count, alphabetically', () => {
      expect(component.evalCategories()).toEqual([
        { category: 'ambiguity', count: 1 },
        { category: 'ties', count: 2 },
      ]);
    });

    it('shows every question when no category is picked', () => {
      expect(component.visibleCases().map((c) => c.id)).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('narrows the list to the picked category', () => {
      component.categoryFilter.set('ties');
      expect(component.visibleCases().map((c) => c.id)).toEqual(['a', 'c']);
    });

    it('unticks only the visible questions, leaving hidden ones selected', () => {
      component.categoryFilter.set('ties');
      component.toggleAllCases();
      expect([...component.selectedCaseIds()]).toEqual(['b']);
    });

    it('ticks the visible questions without disturbing the rest', () => {
      component.selectedCaseIds.set(new Set(['b']));
      component.categoryFilter.set('ties');
      component.toggleAllCases();
      expect([...component.selectedCaseIds()].sort()).toEqual(['a', 'b', 'c']);
    });

    it('reports "all selected" against the visible set, not the whole suite', () => {
      component.selectedCaseIds.set(new Set(['a', 'c']));
      expect(component.allCasesSelected()).toBe(false);
      component.categoryFilter.set('ties');
      expect(component.allCasesSelected()).toBe(true);
    });
  });

  describe('run telemetry', () => {
    it('labels measured tokens compactly', () => {
      expect(component.runTokensLabel(run({ usage: usage() }))).toBe(
        '41.2k tokens',
      );
    });

    it('says tokens were not measured when nothing was reported', () => {
      expect(component.runTokensLabel(run())).toBe('tokens not measured');
      expect(
        component.runTokensLabel(run({ usage: usage({ calls: 0 }) })),
      ).toBe('tokens not measured');
      expect(component.runHasUsage(run({ usage: usage({ calls: 0 }) }))).toBe(
        false,
      );
    });

    it('never shows $0.00 for a run with no cost estimate', () => {
      const cost = component.runCost(run({ usage: usage() }));
      expect(cost.kind).toBe('not-priced');
      expect(cost.label).toBe(
        'not priced — add the model to logs/pricing.json',
      );
    });

    it('orders category rates worst first', () => {
      const rates = component.runCategoryRates(
        run({
          categories: {
            ties: { total: 2, passed: 2 },
            'value-vocabulary': { total: 4, passed: 1 },
          },
        }),
      );
      expect(rates.map((r) => r.category)).toEqual([
        'value-vocabulary',
        'ties',
      ]);
      expect(component.rateClass(rates[0].rate)).toBe('text-red-400');
      expect(component.rateLabel(rates[1].rate)).toBe('100%');
    });

    it('falls back to the suite id when a run predates suite names', () => {
      expect(component.runSuiteLabel(run({ suiteName: '' }))).toBe(
        'health-insurance',
      );
    });

    it('detects a comparison that moved nothing', () => {
      const unmoved = run({
        comparison: {
          previousRunId: 'job-0',
          regressions: [],
          improvements: [],
          unchanged: [{ id: 'a', question: 'Question a?' }],
        },
      });
      expect(component.hasComparison(unmoved)).toBe(true);
      expect(component.comparisonUnmoved(unmoved)).toBe(true);

      const moved = run({
        comparison: {
          previousRunId: 'job-0',
          regressions: [{ id: 'a', question: 'Question a?' }],
          improvements: [],
          unchanged: [],
        },
      });
      expect(component.comparisonUnmoved(moved)).toBe(false);
    });

    it('reports no comparison when the run has none', () => {
      expect(component.hasComparison(run())).toBe(false);
      expect(component.comparisonUnmoved(run())).toBe(false);
    });
  });

  describe('selects', () => {
    // Options are created by @for in the same pass as the select's [value],
    // so a plain value binding lands before they exist and the browser falls
    // back to the first option. [selected] on each option keeps the display
    // honest when the chosen value is not the first one.
    it('displays the chosen datasource, not the first option', () => {
      fixture.componentRef.setInput('agentKey', 'assistant');
      fixture.detectChanges();
      component.agent.set({
        key: 'assistant',
        id: 'assistant',
        name: 'Assistant',
        description: '',
        tools: [],
        toolDetails: [],
      } as never);
      component.loading.set(false);
      // Skip the tab's own fetch; this test renders state set by hand.
      (component as unknown as { evalsRequested: { set(v: boolean): void } })
        .evalsRequested.set(true);
      component.activeTab.set('evals');
      component.evalSets.set([evalSet('world-cup', [evalCase('a', 'control')])]);
      component.selectSet('world-cup');
      component.datasources.set([
        { id: 'ds-1', name: 'First', kind: 'postgres' },
        { id: 'ds-2', name: 'Second', kind: 'postgres' },
      ] as never);
      component.selectedDatasourceId.set('ds-2');
      component.evalsLoading.set(false);
      fixture.detectChanges();

      const select: HTMLSelectElement = fixture.nativeElement.querySelector(
        '[data-testid="eval-datasource-select"]',
      );
      expect(select).toBeTruthy();
      expect(select.value).toBe('ds-2');
    });
  });

  describe('stale responses', () => {
    function deferEvals(): Array<{ next(res: unknown): void }> {
      const api = (component as any).api;
      const handlers: any[] = [];
      spyOn(api, 'getAgentEvals').and.callFake(
        () => ({ subscribe: (h: any) => handlers.push(h) }) as any,
      );
      return handlers;
    }

    it('ignores a response that lands after a newer one', () => {
      const handlers = deferEvals();
      (component as any).loadEvals('assistant');
      (component as any).loadEvals('assistant');

      // Newest first, then the slow one.
      handlers[1].next({ sets: [evalSet('genomics', [evalCase('g', 'ties')])] });
      handlers[0].next({ sets: [evalSet('stale', [evalCase('s', 'ties')])] });

      expect(component.evalSets().map((set) => set.id)).toEqual(['genomics']);
    });

    it('drops the previous agent\'s sets when the agent changes mid-request', () => {
      fixture.componentRef.setInput('agentKey', 'assistant');
      fixture.detectChanges();
      const handlers = deferEvals();
      (component as any).loadEvals('assistant');

      fixture.componentRef.setInput('agentKey', 'visualization');
      fixture.detectChanges();
      handlers[0].next({ sets: [evalSet('world-cup', [evalCase('a', 'control')])] });

      expect(component.evalSets()).toEqual([]);
    });
  });

  describe('dataset scope', () => {
    beforeEach(() => {
      component.evalSets.set([
        evalSet('genomics', [evalCase('g', 'ties')], { datasets: ['Genomics'] }),
        evalSet('world-cup', [evalCase('a', 'control')], {
          datasets: ['World Cup'],
        }),
      ]);
      component.selectSet('genomics');
      component.datasetNames.set(['Genomics', 'Health Insurance']);
    });

    it("defaults to the open set's own datasets", () => {
      expect(component.scopeSelection()).toEqual(['Genomics']);
      expect(component.isDatasetSelected('Genomics')).toBe(true);
      expect(component.isDatasetSelected('Health Insurance')).toBe(false);
    });

    it('lets the operator pick the databases explicitly', () => {
      component.toggleDataset('Health Insurance');
      expect(component.scopeSelection()).toEqual([
        'Genomics',
        'Health Insurance',
      ]);
      component.toggleDataset('Genomics');
      expect(component.scopeSelection()).toEqual(['Health Insurance']);
      // Unticking the last one falls back to the set's own.
      component.toggleDataset('Health Insurance');
      expect(component.scopeSelection()).toEqual(['Genomics']);
    });

    it('forgets an explicit scope when another set is opened', () => {
      component.toggleDataset('Health Insurance');
      component.selectSet('world-cup');
      expect(component.selectedDatasets()).toEqual([]);
      expect(component.scopeSelection()).toEqual(['World Cup']);
    });

    it('sends only an explicit scope with the run', () => {
      fixture.componentRef.setInput('agentKey', 'assistant');
      const api = (component as any).api;
      const start = spyOn(api, 'startEvalRun').and.returnValue({
        subscribe: () => undefined,
      } as any);
      component.selectedDatasourceId.set('ds-1');

      component.startRun();
      const first = start.calls.mostRecent().args[1] as {
        suiteId?: string;
        datasets?: string[];
      };
      expect(first.suiteId).toBe('genomics');
      expect(first.datasets).toBeUndefined();

      component.runStarting.set(false);
      component.toggleDataset('Health Insurance');
      component.startRun();
      expect(
        (start.calls.mostRecent().args[1] as { datasets?: string[] }).datasets,
      ).toEqual(['Genomics', 'Health Insurance']);
    });
  });

  describe('set list', () => {
    beforeEach(() => {
      component.evalSets.set([
        evalSet('world-cup', [evalCase('a', 'control')]),
        evalSet('genomics', [evalCase('b', 'ties'), evalCase('c', 'ties')], {
          datasets: ['variants', 'samples'],
        }),
      ]);
    });

    it('starts with no set open and no question shown', () => {
      expect(component.selectedSet()).toBeNull();
      expect(component.evalCases()).toEqual([]);
    });

    it('opens a set, and closes it when clicked again', () => {
      component.selectSet('genomics');
      expect(component.evalCases().map((c) => c.id)).toEqual(['b', 'c']);
      component.selectSet('genomics');
      expect(component.selectedSet()).toBeNull();
      expect(component.selectedCaseIds().size).toBe(0);
    });

    it('clears the category filter, refusal and last results when switching sets', () => {
      component.selectSet('genomics');
      component.categoryFilter.set('ties');
      component.runResults.set([
        {
          id: 'b',
          question: 'Question b?',
          scores: {},
          checkResults: [],
          answer: '',
          toolCalls: [],
          passed: true,
          durationMs: 1,
        },
      ]);
      component.runError.set('Missing entities: genomics.variants');
      component.selectSet('world-cup');
      expect(component.runError()).toBeNull();
      expect(component.categoryFilter()).toBe('');
      expect(component.runResults()).toEqual([]);
      expect([...component.selectedCaseIds()]).toEqual(['a']);
    });

    it('scopes to the set datasets until a run reports its own', () => {
      component.selectSet('genomics');
      expect(component.scopeDatasets()).toEqual(['variants', 'samples']);

      component.runDatasets.set(['genomics_demo']);
      expect(component.scopeDatasets()).toEqual(['genomics_demo']);
    });
  });

  describe('run controls', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('agentKey', 'assistant');
      component.selectedDatasourceId.set('ds-1');
      component.evalSets.set([
        evalSet('health-insurance', [evalCase('a', 'ties')]),
      ]);
      component.selectSet('health-insurance');
    });

    function captureStartRequest(): { request: unknown } {
      const box: { request: unknown } = { request: null };
      const api = (component as unknown as { api: unknown }).api as {
        startEvalRun: (...args: unknown[]) => unknown;
      };
      spyOn(api, 'startEvalRun').and.callFake((_key, request) => {
        box.request = request;
        return { subscribe: () => undefined };
      });
      return box;
    }

    it('sends repeat, arm, label and includeVariants in the start payload', () => {
      const box = captureStartRequest();

      component.repeat.set(3);
      component.selectedArm.set('fixer-off');
      component.runLabel.set('iter0-gpt5');
      component.includeVariants.set(true);
      component.startRun();

      expect(box.request).toEqual(
        jasmine.objectContaining({
          datasourceId: 'ds-1',
          caseIds: ['a'],
          suiteId: 'health-insurance',
          repeat: 3,
          arm: 'fixer-off',
          label: 'iter0-gpt5',
          includeVariants: true,
        }),
      );
    });

    it('defaults to repeat 1 and the baseline arm with no label', () => {
      const box = captureStartRequest();
      component.startRun();
      expect(box.request).toEqual(
        jasmine.objectContaining({ repeat: 1, arm: 'baseline' }),
      );
      expect((box.request as { label?: string }).label).toBeUndefined();
      expect(
        (box.request as { includeVariants?: boolean }).includeVariants,
      ).toBeUndefined();
    });

    it('encodes a custom arm as parsed overrides under `engine`', () => {
      const box = captureStartRequest();
      component.selectedArm.set('custom');
      component.customOverrideText.set('sqlRepair=false,careful=auto');
      component.startRun();

      expect((box.request as { arm?: string }).arm).toBe('custom');
      expect((box.request as { engine?: object }).engine).toEqual({
        sqlRepair: false,
        careful: 'auto',
      });
    });

    it('collects custom override parse errors and blocks the run', () => {
      component.selectedArm.set('custom');
      component.customOverrideText.set('notAKeyValuePair');
      expect(component.customOverrideErrors()).toEqual([
        '"notAKeyValuePair" is not key=value',
      ]);

      const api = (component as unknown as { api: unknown }).api as {
        startEvalRun: (...args: unknown[]) => unknown;
      };
      const spy = spyOn(api, 'startEvalRun');
      component.startRun();
      expect(spy).not.toHaveBeenCalled();
    });

    it('lists baseline first among the arms the backend reports', () => {
      component.engineSettings.set({
        defaults: {} as never,
        stored: {},
        productionDefaults: {} as never,
        judgeModel: null,
        databricksReasoningEffort: false,
        arms: { 'fixer-off': {}, baseline: {}, 'context-full': {} },
        armDescriptions: {},
        ruleGroups: [],
      });
      expect(component.armNames()).toEqual([
        'baseline',
        'fixer-off',
        'context-full',
      ]);
    });
  });

  describe('verdict badges', () => {
    it('labels a GAP verdict and explains it is not counted', () => {
      const result = evalResult('a', { verdict: 'GAP', passed: false });
      expect(component.resultVerdictLabel(result)).toBe('GAP');
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
        passes: 1,
      });
      expect(component.resultVerdictLabel(result)).toBe('FAIL 1/3');
    });

    it('derives PASS for a legacy result with no explicit verdict', () => {
      const result = evalResult('a', { passed: true });
      expect(component.resultVerdictLabel(result)).toBe('PASS');
      expect(component.resultVerdictTooltip(result)).toBeUndefined();
    });
  });
});
