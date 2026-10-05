import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AgentEvalCase,
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
});
