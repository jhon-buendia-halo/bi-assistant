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
  Cpu,
  Trash2,
  Gauge,
  Loader2,
  ListChecks,
  MessageSquarePlus,
  ChevronRight,
  Download,
  Play,
  ScrollText,
  Upload,
  Wrench,
} from 'lucide-angular';
import {
  AgentDetail as AgentDetailModel,
  AgentEvalCase,
  AgentEvalCaseResult,
  AgentEvalSet,
  AgentsApiService,
  EvalRunView,
} from '../../services/agents-api.service';
import { EvalSelectionService } from '../../services/eval-selection.service';
import {
  canStartChat,
  startChatBlockedReason,
} from '../../services/agent-hub.util';
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
  readonly Cpu = Cpu;
  readonly Gauge = Gauge;
  readonly Loader2 = Loader2;
  readonly ListChecks = ListChecks;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly ChevronRight = ChevronRight;
  readonly Download = Download;
  readonly Play = Play;
  readonly Trash2 = Trash2;
  readonly ScrollText = ScrollText;
  readonly Upload = Upload;
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
  /** Emitted after a user agent is deleted; the app returns to the hub. */
  readonly deleted = output<void>();
  /** Start chat; the shell creates or composes the session (R53). */
  readonly startChat = output<AgentDetailModel>();
  /** True while a session is being created from this agent. */
  readonly starting = input(false);

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
      this.selectedCaseIds.set(new Set());
      this.evalTab.set('questions');
      this.evalRuns.set([]);
      this.expandedRunId.set(null);
      this.evalSelection.clear();
      this.publishing.set(false);
      this.deleting.set(false);
      this.loadAgent(key);
    });
  }

  private loadAgent(key: string): void {
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
  }

  /** User agents only; built-in agents offer neither Publish nor Delete (R5). */
  readonly isUserAgent = computed(() => this.agent()?.kind === 'user');

  /** The Official agent and Live user agents offer Start chat (R53). */
  readonly showStartChat = computed(() => {
    const agent = this.agent();
    return !!agent && canStartChat(agent);
  });
  /** Set when none of the agent's datasets exist; disables Start chat. */
  readonly startChatBlockedReason = computed(() => {
    const agent = this.agent();
    return agent ? startChatBlockedReason(agent) : null;
  });

  /** Publish shows when there is no Live version or it has unpublished changes. */
  readonly canPublish = computed(() => {
    const agent = this.agent();
    return (
      agent?.kind === 'user' &&
      (agent.status !== 'live' || !!agent.hasUnpublishedChanges)
    );
  });

  /** The user agent's own instructions: Live version, else draft (R6). */
  readonly agentInstructions = computed(() => {
    const agent = this.agent();
    return (agent?.live ?? agent?.draft)?.instructions ?? '';
  });

  readonly publishing = signal(false);
  readonly deleting = signal(false);

  publish(): void {
    const agent = this.agent();
    if (!agent || this.publishing()) return;
    this.publishing.set(true);
    this.api.publish(agent.key).subscribe({
      next: (res) => {
        this.publishing.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        if (this.agentKey() === agent.key) this.loadAgent(agent.key);
      },
      error: (err) => {
        this.publishing.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** Ask first; on success return to the hub, on failure stay here (R5). */
  deleteAgent(): void {
    const agent = this.agent();
    if (!agent || this.deleting()) return;
    const confirmed = window.confirm(
      `Delete "${agent.name}"?\n\nIts sessions keep their transcripts and continue with the assistant.`,
    );
    if (!confirmed) return;
    this.deleting.set(true);
    this.api.deleteAgent(agent.key).subscribe({
      next: (res) => {
        this.deleting.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        this.deleted.emit();
      },
      error: (err) => {
        this.deleting.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
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
        this.selectedCaseIds.set(new Set());
        this.evalsLoading.set(false);
      },
      error: (err) => {
        this.evalsError.set(err?.error?.message ?? 'Backend unreachable');
        this.evalsLoading.set(false);
      },
    });
  }

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
        this.toast.error(err?.error?.message ?? 'Could not download the report');
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

  /**
   * Open a question set, revealing its questions; clicking the open set again
   * closes it. Opening ticks all of that set's questions, so a selection is
   * never left pointing at questions that are no longer on screen.
   */
  selectSet(setId: string | null): void {
    const next = this.selectedSetId() === setId ? null : setId;
    this.selectedSetId.set(next);
    this.selectedCaseIds.set(new Set(this.evalCases().map((c) => c.id)));
  }

  /** Questions ticked to run; every question starts selected. */
  readonly selectedCaseIds = signal<Set<string>>(new Set());

  readonly allCasesSelected = computed(() => {
    const cases = this.evalCases();
    return cases.length > 0 && this.selectedCaseIds().size === cases.length;
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

  toggleAllCases(): void {
    this.selectedCaseIds.set(
      this.allCasesSelected()
        ? new Set()
        : new Set(this.evalCases().map((evalCase) => evalCase.id)),
    );
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

    this.api.startEvalRun(this.agentKey(), datasourceId, caseIds).subscribe({
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
