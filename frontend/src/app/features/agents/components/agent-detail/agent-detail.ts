import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  Bot,
  Brain,
  CircleCheck,
  CircleX,
  Coins,
  Cpu,
  Trash2,
  Gauge,
  GitCompare,
  Loader2,
  ListChecks,
  ChevronRight,
  Download,
  Play,
  ScrollText,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-angular';
import {
  AgentDetail as AgentDetailModel,
  AgentEvalSet,
  AgentsApiService,
} from '../../services/agents-api.service';
import {
  AgentEvalCase,
  AgentEvalCaseResult,
  CategoryRate,
  EvalCostState,
  EvalRunView,
  categoryRateClass,
  evalCostState,
  formatRate,
  formatTokenCount,
  formatTokensCompact,
  isUsageMeasured,
  sortedCategoryRates,
} from '../../models/eval.model';
import { EvalSelectionService } from '../../services/eval-selection.service';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  Datasource,
  kindLabel,
} from '../../../datasources/models/datasource.model';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';

type AgentTab = 'prompt' | 'tools' | 'memory' | 'model' | 'evals';
/** Sub-tabs inside the evals tab. */
type EvalTab = 'questions' | 'runs';

@Component({
  selector: 'app-agent-detail',
  imports: [LucideAngularModule],
  templateUrl: './agent-detail.html',
  styleUrl: './agent-detail.scss',
})
export class AgentDetail implements OnDestroy {
  readonly ArrowLeft = ArrowLeft;
  readonly Bot = Bot;
  readonly Brain = Brain;
  readonly CircleCheck = CircleCheck;
  readonly CircleX = CircleX;
  readonly Coins = Coins;
  readonly Cpu = Cpu;
  readonly Gauge = Gauge;
  readonly GitCompare = GitCompare;
  readonly Loader2 = Loader2;
  readonly ListChecks = ListChecks;
  readonly ChevronRight = ChevronRight;
  readonly Download = Download;
  readonly Play = Play;
  readonly Trash2 = Trash2;
  readonly ScrollText = ScrollText;
  readonly TrendingDown = TrendingDown;
  readonly TrendingUp = TrendingUp;
  readonly Wrench = Wrench;

  private readonly api = inject(AgentsApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly evalSelection = inject(EvalSelectionService);
  private readonly toast = inject(ToastService);

  readonly selectedEvalCaseId = computed(
    () => this.evalSelection.selection()?.evalCase.id ?? null,
  );

  /** Open a question in the right panel, with its result when it has one. */
  selectEvalCase(evalCase: AgentEvalCase): void {
    this.evalSelection.select({
      evalCase,
      result: this.resultFor(evalCase.id),
    });
  }

  readonly kindLabel = kindLabel;

  /** Registry key of the agent to show. */
  readonly agentKey = input.required<string>();
  readonly back = output<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly agent = signal<AgentDetailModel | null>(null);
  readonly activeTab = signal<AgentTab>('prompt');

  readonly tabs = computed(() => {
    const agent = this.agent();
    return [
      {
        id: 'prompt' as const,
        label: 'Prompt template',
        icon: this.ScrollText,
      },
      {
        id: 'tools' as const,
        label: `Tools${agent ? ` (${agent.toolDetails.length})` : ''}`,
        icon: this.Wrench,
      },
      { id: 'memory' as const, label: 'Memory', icon: this.Brain },
      { id: 'model' as const, label: 'Model', icon: this.Cpu },
      { id: 'evals' as const, label: 'Evals', icon: this.Gauge },
    ];
  });

  constructor() {
    // The eval list is only needed once the evals tab is opened. The guard is
    // a dedicated flag rather than the result signals, which this effect also
    // writes — reading those here would refetch in a loop.
    effect(() => {
      if (this.activeTab() !== 'evals' || this.evalsRequested()) return;
      this.evalsRequested.set(true);
      this.loadEvals(this.agentKey());
      this.loadDatasources();
    });

    // Reload whenever the selected agent changes.
    effect(() => {
      const key = this.agentKey();
      this.loading.set(true);
      this.error.set(null);
      this.activeTab.set('prompt');
      this.evalsRequested.set(false);
      this.evalSets.set([]);
      this.selectedSetId.set(null);
      this.categoryFilter.set('');
      this.selectedCaseIds.set(new Set());
      this.evalTab.set('questions');
      this.evalRuns.set([]);
      this.expandedRunId.set(null);
      this.evalSelection.clear();
      this.api.getAgent(key).subscribe({
        next: (agent) => {
          this.agent.set(agent);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message ?? 'Backend unreachable');
          this.loading.set(false);
        },
      });
    });
  }

  /** Question sets for this agent, loaded when the evals tab is opened. */
  readonly evalSets = signal<AgentEvalSet[]>([]);
  /** The set whose questions the tab is showing. */
  readonly selectedSetId = signal<string | null>(null);

  readonly selectedSet = computed(
    () => this.evalSets().find((set) => set.id === this.selectedSetId()) ?? null,
  );

  /** Questions of the selected set — what the list renders and the run submits. */
  readonly evalCases = computed(() => this.selectedSet()?.cases ?? []);

  /**
   * Every question across every set. A past run may hold results for a set
   * other than the one on screen, so run results resolve against all of them.
   */
  private readonly allEvalCases = computed(() =>
    this.evalSets().flatMap((set) => set.cases),
  );
  readonly evalsLoading = signal(false);
  readonly evalsError = signal<string | null>(null);
  /** Set once the evals tab has triggered its one fetch for this agent. */
  private readonly evalsRequested = signal(false);

  private loadEvals(key: string): void {
    this.evalsLoading.set(true);
    this.evalsError.set(null);
    this.api.getAgentEvals(key).subscribe({
      next: (res) => {
        this.evalSets.set(res.sets);
        // No set is opened for you — the questions stay hidden until one is
        // clicked, so the tab always starts on the set list.
        this.selectedSetId.set(null);
        this.categoryFilter.set('');
        this.selectedCaseIds.set(new Set());
        this.evalsLoading.set(false);
      },
      error: (err) => {
        this.evalsError.set(err?.error?.message ?? 'Backend unreachable');
        this.evalsLoading.set(false);
      },
    });
  }

  /**
   * Open a question set, revealing its questions; clicking the open set again
   * closes it. Opening ticks all of that set's questions, so a selection is
   * never left pointing at questions that are no longer on screen. The last
   * run's results belong to whichever set it ran, so they are cleared too.
   */
  selectSet(setId: string | null): void {
    const next = this.selectedSetId() === setId ? null : setId;
    if (next !== this.selectedSetId()) {
      this.evalSelection.clear();
      this.runError.set(null);
      this.runResults.set([]);
      this.runStatus.set('idle');
      this.runCurrentQuestion.set(null);
      this.runDatasets.set([]);
    }
    this.selectedSetId.set(next);
    this.categoryFilter.set('');
    this.selectedCaseIds.set(new Set(this.evalCases().map((c) => c.id)));
  }

  /**
   * What the questions run against: the datasets the live run reported, or —
   * before anything has run — the ones the open set is written for.
   */
  readonly scopeDatasets = computed(() => {
    const fromRun = this.runDatasets();
    if (fromRun.length > 0) return fromRun;
    return this.selectedSet()?.datasets ?? [];
  });

  readonly evalTab = signal<EvalTab>('questions');

  /** Past executions, newest first. */
  readonly evalRuns = signal<EvalRunView[]>([]);
  readonly evalRunsLoading = signal(false);
  readonly expandedRunId = signal<string | null>(null);

  selectEvalTab(tab: EvalTab): void {
    this.evalTab.set(tab);
    if (tab === 'runs') this.loadEvalRuns();
  }

  toggleRun(jobId: string): void {
    this.expandedRunId.set(this.expandedRunId() === jobId ? null : jobId);
  }

  private loadEvalRuns(): void {
    this.evalRunsLoading.set(true);
    this.api.listEvalRuns(this.agentKey()).subscribe({
      next: (res) => {
        this.evalRuns.set(res.runs);
        this.evalRunsLoading.set(false);
      },
      error: () => {
        this.evalRuns.set([]);
        this.evalRunsLoading.set(false);
      },
    });
  }

  readonly downloadingRunId = signal<string | null>(null);

  /** Save the run as a Markdown report. */
  downloadRun(run: EvalRunView): void {
    if (this.downloadingRunId()) return;
    this.downloadingRunId.set(run.jobId);
    this.api.downloadEvalRun(this.agentKey(), run.jobId).subscribe({
      next: (blob) => {
        this.downloadingRunId.set(null);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `eval-run-${run.agentKey}-${run.jobId.slice(0, 8)}.md`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.toast.success('Eval report downloaded');
      },
      error: (err) => {
        this.downloadingRunId.set(null);
        this.toast.error(
          err?.error?.message ?? 'Could not download the report',
        );
      },
    });
  }

  deleteRun(jobId: string): void {
    this.api.deleteEvalRun(this.agentKey(), jobId).subscribe({
      next: (res) => {
        if (res.ok)
          this.evalRuns.set(this.evalRuns().filter((r) => r.jobId !== jobId));
      },
    });
  }

  /** Open a question from a past run in the right panel. */
  selectRunResult(result: AgentEvalCaseResult): void {
    const evalCase = this.allEvalCases().find((c) => c.id === result.id);
    if (!evalCase) return;
    this.evalSelection.select({ evalCase, result });
  }

  passedIn(run: EvalRunView): number {
    return run.results.filter((result) => result.passed).length;
  }

  runDuration(run: EvalRunView): string {
    if (!run.finishedAt) return '—';
    const ms =
      new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`;
  }

  startedLabel(run: EvalRunView): string {
    return new Date(run.startedAt).toLocaleString();
  }

  datasourceName(id: string): string {
    return this.datasources().find((d) => d.id === id)?.name ?? id;
  }

  /* ---- Run telemetry ------------------------------------------------- */

  /** Exact counts, grouped: `41,231`. */
  readonly tokenCount = formatTokenCount;
  readonly rateLabel = formatRate;
  readonly rateClass = categoryRateClass;

  /** Which suite the run covered; older records carry neither field. */
  runSuiteLabel(run: EvalRunView): string {
    return run.suiteName || run.suiteId || 'unknown suite';
  }

  /** True once the provider reported at least one call's worth of tokens. */
  runHasUsage(run: EvalRunView): boolean {
    return isUsageMeasured(run.usage);
  }

  /** Header meta: `41.2k tokens`, or nothing measured at all. */
  runTokensLabel(run: EvalRunView): string {
    const usage = run.usage;
    if (!isUsageMeasured(usage) || !usage) return 'tokens not measured';
    return `${formatTokensCompact(usage.totalTokens)} tokens`;
  }

  /** Never invents a number: see {@link evalCostState}. */
  runCost(run: EvalRunView): EvalCostState {
    return evalCostState(run.usage, run.estimatedCostUsd);
  }

  /** Per-category pass rates, worst first. */
  runCategoryRates(run: EvalRunView): CategoryRate[] {
    return sortedCategoryRates(run.categories);
  }

  /** True when the run was diffed against a previous one. */
  hasComparison(run: EvalRunView): boolean {
    return !!run.comparison;
  }

  /** A comparison with nothing moved either way. */
  comparisonUnmoved(run: EvalRunView): boolean {
    const comparison = run.comparison;
    if (!comparison) return false;
    return (
      comparison.regressions.length === 0 &&
      comparison.improvements.length === 0
    );
  }

  /** Questions ticked to run; every question starts selected. */
  readonly selectedCaseIds = signal<Set<string>>(new Set());

  /** Failure class the list is narrowed to; `''` shows every question. */
  readonly categoryFilter = signal<string>('');

  /** The categories present in the open set, alphabetically. */
  readonly evalCategories = computed(() => {
    const seen = new Map<string, number>();
    for (const evalCase of this.evalCases()) {
      if (!evalCase.category) continue;
      seen.set(evalCase.category, (seen.get(evalCase.category) ?? 0) + 1);
    }
    return [...seen.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category));
  });

  /** Questions the filter lets through — what "Select all" operates on. */
  readonly visibleCases = computed(() => {
    const filter = this.categoryFilter();
    const cases = this.evalCases();
    return filter ? cases.filter((c) => c.category === filter) : cases;
  });

  onCategoryFilterChange(event: Event): void {
    this.categoryFilter.set((event.target as HTMLSelectElement).value);
  }

  /** True when every *visible* question is ticked. */
  readonly allCasesSelected = computed(() => {
    const visible = this.visibleCases();
    const selected = this.selectedCaseIds();
    return visible.length > 0 && visible.every((c) => selected.has(c.id));
  });

  isCaseSelected(caseId: string): boolean {
    return this.selectedCaseIds().has(caseId);
  }

  toggleCase(caseId: string): void {
    const next = new Set(this.selectedCaseIds());
    if (next.has(caseId)) next.delete(caseId);
    else next.add(caseId);
    this.selectedCaseIds.set(next);
  }

  /**
   * Tick or untick the visible questions only, leaving whatever is hidden by
   * the filter alone — otherwise filtering would silently drop a selection.
   */
  toggleAllCases(): void {
    const next = new Set(this.selectedCaseIds());
    const visible = this.visibleCases();
    if (this.allCasesSelected()) {
      for (const evalCase of visible) next.delete(evalCase.id);
    } else {
      for (const evalCase of visible) next.add(evalCase.id);
    }
    this.selectedCaseIds.set(next);
  }

  /** Datasources offered in the run dropdown. */
  readonly datasources = signal<Datasource[]>([]);
  readonly selectedDatasourceId = signal<string>('');

  /** Live state of the current run. */
  readonly runStarting = signal(false);
  readonly runError = signal<string | null>(null);
  readonly runStatus = signal<'idle' | 'running' | 'completed' | 'failed'>(
    'idle',
  );
  readonly runResults = signal<AgentEvalCaseResult[]>([]);
  readonly runCurrentQuestion = signal<string | null>(null);
  readonly runDatasets = signal<string[]>([]);
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  readonly running = computed(() => this.runStatus() === 'running');
  readonly passedCount = computed(
    () => this.runResults().filter((result) => result.passed).length,
  );

  /** Result for a question, once it has finished. */
  resultFor(caseId: string): AgentEvalCaseResult | undefined {
    return this.runResults().find((result) => result.id === caseId);
  }

  private loadDatasources(): void {
    this.datasourcesApi.list().subscribe({
      next: (res) => {
        this.datasources.set(res.datasources);
        if (!this.selectedDatasourceId() && res.datasources.length > 0) {
          this.selectedDatasourceId.set(res.datasources[0].id);
        }
      },
      error: () => this.datasources.set([]),
    });
  }

  onDatasourceChange(event: Event): void {
    this.selectedDatasourceId.set((event.target as HTMLSelectElement).value);
  }

  startRun(): void {
    const datasourceId = this.selectedDatasourceId();
    const caseIds = [...this.selectedCaseIds()];
    if (!datasourceId || caseIds.length === 0) return;
    if (this.running() || this.runStarting()) return;

    this.runStarting.set(true);
    this.runError.set(null);
    this.runResults.set([]);
    this.runCurrentQuestion.set(null);
    this.syncSelection();

    const suiteId = this.selectedSetId() || undefined;
    this.api
      .startEvalRun(this.agentKey(), datasourceId, caseIds, suiteId)
      .subscribe({
        next: (res) => {
          this.runStarting.set(false);
          if (!res.ok || !res.jobId) {
            this.runError.set(res.message);
            this.runStatus.set('idle');
            return;
          }
          this.runStatus.set('running');
          this.pollRun(res.jobId);
        },
        error: (err) => {
          this.runStarting.set(false);
          this.runStatus.set('idle');
          this.runError.set(err?.error?.message ?? 'Backend unreachable');
        },
      });
  }

  /** Poll until the job leaves `running`; each question lands as it finishes. */
  private pollRun(jobId: string): void {
    this.api.getEvalRun(this.agentKey(), jobId).subscribe({
      next: (view) => {
        if (!view.ok) {
          this.runStatus.set('failed');
          this.runError.set(view.message);
          return;
        }
        this.runResults.set(view.results ?? []);
        this.syncSelection();
        this.runCurrentQuestion.set(view.currentQuestion ?? null);
        this.runDatasets.set(view.datasets ?? []);
        if (view.status === 'running') {
          this.pollTimer = setTimeout(() => this.pollRun(jobId), 1500);
          return;
        }
        this.runStatus.set(view.status ?? 'completed');
        if (view.error) this.runError.set(view.error);
        // The finished run belongs in the history list.
        if (this.evalTab() === 'runs') this.loadEvalRuns();
      },
      error: (err) => {
        this.runStatus.set('failed');
        this.runError.set(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** Re-point the panel at the selected question's latest result. */
  private syncSelection(): void {
    const selected = this.evalSelection.selection();
    if (!selected) return;
    this.evalSelection.select({
      evalCase: selected.evalCase,
      result: this.resultFor(selected.evalCase.id),
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.pollTimer);
    this.evalSelection.clear();
  }

  lastMessagesLabel(value: number | false | null): string {
    if (value === false) return 'Disabled';
    if (value === null) return 'Default';
    return `${value} messages`;
  }

  onOff(value: boolean): string {
    return value ? 'Enabled' : 'Disabled';
  }
}
