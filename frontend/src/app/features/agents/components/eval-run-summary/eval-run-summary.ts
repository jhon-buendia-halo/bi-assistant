/**
 * The body of an expanded run card in Agents → Evals → Executions.
 *
 * Run log v2 (`docs/plans/improvement-loop-execution.md` §2.3/2.6) adds a
 * pass^k rollup (`EvalRunView.summary`) that a run recorded before it existed
 * simply does not have — so every stat here degrades gracefully: `summary`
 * present renders the pass^k headline, chips and worst-first pass^k tables;
 * absent falls back to the pass-rate-per-category table Executions already
 * showed. Nothing here invents a number `evalCostState`/`costPerCorrectLabel`
 * would not already stand behind.
 */
import { Component, computed, input, output } from '@angular/core';
import {
  LucideAngularModule,
  CircleCheck,
  CircleHelp,
  CircleX,
  Coins,
  GitCompare,
  TrendingDown,
  TrendingUp,
} from 'lucide-angular';
import {
  AgentEvalCaseResult,
  CategoryRate,
  CategoryTally,
  EvalRunView,
  EvalVerdict,
  armLabel,
  categoryRateClass,
  costPerCorrectLabel,
  evalCostState,
  formatPassK,
  formatRate,
  formatTokenCount,
  isUsageMeasured,
  sortedCategoryRates,
  verdictClass,
  verdictOf,
} from '../../models/eval.model';

@Component({
  selector: 'app-eval-run-summary',
  imports: [LucideAngularModule],
  templateUrl: './eval-run-summary.html',
  styleUrl: './eval-run-summary.scss',
})
export class EvalRunSummary {
  readonly CircleCheck = CircleCheck;
  readonly CircleX = CircleX;
  readonly CircleHelp = CircleHelp;
  readonly Coins = Coins;
  readonly GitCompare = GitCompare;
  readonly TrendingDown = TrendingDown;
  readonly TrendingUp = TrendingUp;

  readonly run = input.required<EvalRunView>();
  /** A question row was clicked — the parent owns eval selection. */
  readonly selectResult = output<AgentEvalCaseResult>();

  readonly summary = computed(() => this.run().summary);

  /** `"claims" · "members"` — what the run was actually scoped to. */
  readonly suiteLabel = computed(() => {
    const run = this.run();
    return run.suiteName || run.suiteId || 'unknown suite';
  });

  /** Arm/model/effort/judge/config chips — shown when the run recorded them. */
  readonly chips = computed(() => {
    const run = this.run();
    const chips: { label: string; value: string }[] = [
      { label: 'arm', value: armLabel(run.arm) },
    ];
    if (run.model) chips.push({ label: 'model', value: run.model });
    if (run.reasoningEffort)
      chips.push({ label: 'effort', value: run.reasoningEffort });
    if (run.judgeModel) chips.push({ label: 'judge', value: run.judgeModel });
    if (run.configHash) chips.push({ label: 'config', value: run.configHash });
    return chips;
  });

  /** `"12/19 pass^3 · 63% · 1 gap"`. */
  readonly headline = computed(() => {
    const summary = this.summary();
    if (!summary) return '';
    return formatPassK(summary, this.run().repeat ?? 1);
  });

  readonly meanRateLabel = computed(() => {
    const summary = this.summary();
    return summary ? formatRate(summary.meanPassRate) : '';
  });

  /** `"answered 19/19"` — every attempt produced an answer, correct or not. */
  readonly answeredLabel = computed(() => {
    const summary = this.summary();
    if (!summary) return null;
    const denominator = summary.answeredObserved ?? this.run().totalCases;
    return `answered ${summary.answeredEveryTime}/${denominator}`;
  });

  readonly costLabel = computed(() => {
    const summary = this.summary();
    if (!summary) return '';
    return costPerCorrectLabel(summary, this.run().usage);
  });

  /** Per-category pass^k, worst first — `byCategory`'s `passK` read as a tally. */
  readonly categoryPassKRates = computed<CategoryRate[]>(() => {
    const summary = this.summary();
    if (!summary) return [];
    const tallies: Record<string, CategoryTally> = {};
    for (const [category, tally] of Object.entries(summary.byCategory)) {
      tallies[category] = { total: tally.total, passed: tally.passK };
    }
    return sortedCategoryRates(tallies);
  });

  /** Same shape, over `byDifficulty`. */
  readonly difficultyPassKRates = computed<CategoryRate[]>(() => {
    const summary = this.summary();
    if (!summary) return [];
    const tallies: Record<string, CategoryTally> = {};
    for (const [difficulty, tally] of Object.entries(summary.byDifficulty)) {
      tallies[difficulty] = { total: tally.total, passed: tally.passK };
    }
    return sortedCategoryRates(tallies);
  });

  /** Today's rendering — pre-v2 runs have no `summary` to build pass^k from. */
  readonly legacyCategoryRates = computed<CategoryRate[]>(() =>
    sortedCategoryRates(this.run().categories),
  );

  readonly rateLabel = formatRate;
  readonly rateClass = categoryRateClass;
  readonly tokenCount = formatTokenCount;

  runHasUsage(): boolean {
    return isUsageMeasured(this.run().usage);
  }

  runCost() {
    const run = this.run();
    return evalCostState(run.usage, run.estimatedCostUsd);
  }

  comparisonUnmoved(): boolean {
    const comparison = this.run().comparison;
    if (!comparison) return false;
    return (
      comparison.regressions.length === 0 &&
      comparison.improvements.length === 0
    );
  }

  /* ---- Per-question verdict badge (incl. GAP) ------------------------ */

  resultVerdict(result: AgentEvalCaseResult): EvalVerdict {
    return verdictOf(result);
  }

  resultVerdictClass(result: AgentEvalCaseResult): string {
    return verdictClass(verdictOf(result));
  }

  resultVerdictIcon(result: AgentEvalCaseResult) {
    switch (verdictOf(result)) {
      case 'PASS':
        return this.CircleCheck;
      case 'FAIL':
      case 'ERROR':
        return this.CircleX;
      default:
        return this.CircleHelp;
    }
  }

  /** `" 2/3"` when the case ran more than once, else `""`. */
  resultPassesRunsSuffix(result: AgentEvalCaseResult): string {
    return result.runs && result.runs > 1
      ? ` ${result.passes ?? 0}/${result.runs}`
      : '';
  }

  /** GAP is a harness problem, not a wrong answer — say so on hover. */
  resultVerdictTooltip(result: AgentEvalCaseResult): string | undefined {
    return verdictOf(result) === 'GAP'
      ? 'the harness could not measure this — not counted'
      : undefined;
  }
}
