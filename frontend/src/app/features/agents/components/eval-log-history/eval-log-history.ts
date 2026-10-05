import { Component, effect, inject, input, signal } from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GitCompare,
  RefreshCw,
} from 'lucide-angular';
import { AgentsApiService } from '../../services/agents-api.service';
import { EvalHistoryService } from '../../services/eval-history.service';
import { EvalSelectionService } from '../../services/eval-selection.service';
import {
  EvalHarness,
  EvalRunLogCaseV2,
  RunLogSummary,
  TrendPoint,
  armLabel,
  categoryRateClass,
  harnessLabel,
  logCaseToEvalCase,
  logCaseToResult,
  logSummaryCostLabel,
  logSummaryPassKLabel,
  verdictClass,
} from '../../models/eval.model';
import { EvalRunCompare } from '../eval-run-compare/eval-run-compare';
import { EvalTrendChart } from '../eval-trend-chart/eval-trend-chart';

/**
 * The Evals tab's "History" sub-tab: every run-log v2 file the backend can
 * find (in-app, CLI, `--validate`), filterable, opened into its per-case
 * detail (click-through to the existing trace panel), picked in pairs for
 * Compare, and a trend line of the filtered suite's pass^k over time.
 *
 * Created early (before the backend endpoints exist, per the execution
 * plan's Wave 1/Wave 2 split) so `agent-detail.ts` (owned by a sibling unit)
 * can embed `<app-eval-log-history [agentKey]="agentKey()" />` immediately —
 * it is coded to the contracts in `docs/plans/improvement-loop-execution.md`
 * §2.6/§2.8, not to a running backend.
 */
@Component({
  selector: 'app-eval-log-history',
  imports: [LucideAngularModule, EvalTrendChart, EvalRunCompare],
  templateUrl: './eval-log-history.html',
  styleUrl: './eval-log-history.scss',
})
export class EvalLogHistory {
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly CircleAlert = CircleAlert;
  readonly GitCompare = GitCompare;
  readonly RefreshCw = RefreshCw;

  private readonly api = inject(AgentsApiService);
  private readonly evalSelection = inject(EvalSelectionService);
  readonly history = inject(EvalHistoryService);

  /** Registry key of the agent whose history this shows. */
  readonly agentKey = input.required<string>();

  readonly verdictClass = verdictClass;
  readonly categoryRateClass = categoryRateClass;
  readonly harnessLabel = harnessLabel;
  readonly armLabel = armLabel;
  readonly passKLabel = logSummaryPassKLabel;
  readonly costLabel = logSummaryCostLabel;

  readonly trendPoints = signal<TrendPoint[]>([]);
  readonly trendLoading = signal(false);

  constructor() {
    // Reload whenever the agent changes; one agent's filters/selection must
    // not leak into another's.
    effect(() => {
      const key = this.agentKey();
      this.history.reset();
      this.history.load(key);
    });

    // The trend line follows the suite (and arm) filter, so it always shows
    // "the thing the table is currently narrowed to".
    effect(() => {
      const key = this.agentKey();
      const suite = this.history.suiteFilter();
      const arm = this.history.armFilter();
      this.loadTrend(key, suite || undefined, arm || undefined);
    });
  }

  private loadTrend(key: string, suite?: string, arm?: string): void {
    this.trendLoading.set(true);
    this.api.getTrend(key, suite, arm).subscribe({
      next: (res) => {
        this.trendPoints.set(res.points ?? []);
        this.trendLoading.set(false);
      },
      error: () => {
        this.trendPoints.set([]);
        this.trendLoading.set(false);
      },
    });
  }

  refresh(): void {
    this.history.load(this.agentKey(), true);
  }

  onSuiteFilterChange(event: Event): void {
    this.history.suiteFilter.set((event.target as HTMLSelectElement).value);
  }

  onArmFilterChange(event: Event): void {
    this.history.armFilter.set((event.target as HTMLSelectElement).value);
  }

  onHarnessFilterChange(event: Event): void {
    this.history.harnessFilter.set(
      (event.target as HTMLSelectElement).value as EvalHarness | '',
    );
  }

  onModelFilterChange(event: Event): void {
    this.history.modelFilter.set((event.target as HTMLSelectElement).value);
  }

  open(log: RunLogSummary): void {
    if (!log.exists) return;
    if (this.history.openedFile() === log.file) {
      this.history.closeLog();
      return;
    }
    this.history.openLog(this.agentKey(), log.file);
  }

  isOpen(log: RunLogSummary): boolean {
    return this.history.openedFile() === log.file;
  }

  isSelectedA(log: RunLogSummary): boolean {
    return this.history.selectedA() === log.file;
  }

  isSelectedB(log: RunLogSummary): boolean {
    return this.history.selectedB() === log.file;
  }

  toggleCompare(log: RunLogSummary, event: Event): void {
    event.stopPropagation();
    if (!log.exists) return;
    this.history.toggleCompareSelection(log.file);
  }

  /** Open a logged case in the existing trace panel via the History adapter. */
  selectCase(item: EvalRunLogCaseV2): void {
    this.evalSelection.select({
      evalCase: logCaseToEvalCase(item),
      result: logCaseToResult(item),
    });
  }
}
