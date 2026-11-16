import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Observable,
  concatMap,
  filter,
  of,
  startWith,
  switchMap,
  takeWhile,
  timer,
} from 'rxjs';
import {
  LucideAngularModule,
  ArrowLeft,
  BookOpen,
  Brain,
  CircleCheck,
  CircleX,
  Cpu,
  Trash2,
  Gauge,
  Loader2,
  ListChecks,
  MessageSquare,
  Pencil,
  ChevronRight,
  Download,
  Play,
  ScrollText,
  Upload,
  Workflow,
  Wrench,
} from 'lucide-angular';
import {
  AgentDetail as AgentDetailModel,
  AgentEvalCase,
  AgentEvalCaseResult,
  AgentEvalSet,
  AgentSkillsView,
  AgentsApiService,
  EvalRunView,
} from '../../services/agents-api.service';
import { EvalSelectionService } from '../../services/eval-selection.service';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  BackgroundTaskOutcome,
  BackgroundTasksService,
} from '../../../../core/background-tasks/background-tasks.service';
import { AgentsNavState } from '../../services/agents-nav-state';
import {
  Datasource,
  kindLabel,
} from '../../../datasources/models/datasource.model';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';
import { AgentSkills } from '../agent-skills/agent-skills';
import { AgentLlmConfig } from '../agent-llm-config/agent-llm-config';
import { AgentToolLinks } from '../agent-tool-links/agent-tool-links';
import { AgentTryIt } from '../agent-try-it/agent-try-it';
import { AgentSkillsInline } from '../agent-skills-inline/agent-skills-inline';
import { AgentSystemPrompt } from '../agent-system-prompt/agent-system-prompt';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import { agentActivity } from '../../services/agent-activity';
import { WorkflowRunsApiService } from '../../../workflows/services/workflow-runs-api.service';
import { WorkflowRunSummary } from '../../../workflows/models/workflow.model';
import { AgentPageState } from '../../services/agent-page-state.service';
import {
  AGENT_TAB_ORDER,
  AgentTabId,
  defaultAgentTab,
  hasChatTab,
  includedInEveryAgent,
  skillsCount,
  usedInEmptyText,
} from '../../services/agent-page.util';
import { agentKind } from '../../services/agent-hub.util';
import { knownLinks, linkableBuiltInSkills } from '../../services/prompt-links';
import {
  BuiltInSkillSummary,
  SkillSummary,
  SkillsApiService,
} from '../../services/skills-api.service';

/** One answer of an eval run: the start refusal or a poll of the job. */
type EvalRunTick = { ok: boolean; message: string } & Partial<EvalRunView>;

/** A finished run with failing questions is still a finished task. */
function evalRunOutcome(
  last: EvalRunTick | undefined,
  agentName: string,
): BackgroundTaskOutcome {
  if (!last) return { ok: false, message: 'The evals did not run' };
  if (!last.ok) return { ok: false, message: last.message };
  if (last.status === 'failed') {
    return { ok: false, message: last.error ?? last.message };
  }
  const results = last.results ?? [];
  const passed = results.filter((r) => r.passed).length;
  return {
    ok: true,
    message: `Evals for ${agentName}: ${passed} of ${results.length} passed`,
  };
}

type AgentTab = AgentTabId;
/** Sub-tabs inside the evals tab. */
type EvalTab = 'questions' | 'runs';

@Component({
  selector: 'app-agent-detail',
  imports: [
    LucideAngularModule,
    AgentSkills,
    AgentLlmConfig,
    AgentToolLinks,
    AgentTryIt,
    AgentSkillsInline,
    AgentSystemPrompt,
    AgentAvatar,
  ],
  templateUrl: './agent-detail.html',
  styleUrl: './agent-detail.scss',
})
export class AgentDetail implements OnDestroy {
  readonly ArrowLeft = ArrowLeft;
  readonly BookOpen = BookOpen;
  readonly Brain = Brain;
  readonly CircleCheck = CircleCheck;
  readonly CircleX = CircleX;
  readonly Cpu = Cpu;
  readonly Gauge = Gauge;
  readonly Loader2 = Loader2;
  readonly ListChecks = ListChecks;
  readonly MessageSquare = MessageSquare;
  readonly Pencil = Pencil;
  readonly ChevronRight = ChevronRight;
  readonly Download = Download;
  readonly Play = Play;
  readonly Trash2 = Trash2;
  readonly ScrollText = ScrollText;
  readonly Upload = Upload;
  readonly WorkflowIcon = Workflow;
  readonly Wrench = Wrench;

  private readonly api = inject(AgentsApiService);
  private readonly skillsApi = inject(SkillsApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly evalSelection = inject(EvalSelectionService);
  private readonly toast = inject(ToastService);
  private readonly pageState = inject(AgentPageState);
  private readonly runsApi = inject(WorkflowRunsApiService);
  private readonly tasks = inject(BackgroundTasksService);
  private readonly nav = inject(AgentsNavState);
  private alive = true;

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
  /** A Used in chip; the shell opens the workflow's page (R109). */
  readonly openWorkflow = output<string>();
  /** Edit a user agent; the shell opens the agent editor on its draft (R54). */
  readonly edit = output<AgentDetailModel>();
  /** An admin's Edit on a built-in skill; the shell opens its editor. */
  readonly openBuiltInSkill = output<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly agent = signal<AgentDetailModel | null>(null);
  /** The run history, for the header's status; null until it loads. */
  private readonly runs = signal<WorkflowRunSummary[] | null>(null);

  /** What the agent is doing now (ui.md 4.5); null while unknown. */
  readonly activity = computed(() => {
    const agent = this.agent();
    const runs = this.runs();
    return agent && runs ? agentActivity(agent, runs) : null;
  });
  readonly activeTab = signal<AgentTab>('prompt');
  /** Try it mounts the first time it is shown, then stays. */
  readonly chatMounted = signal(false);

  /** The skills tab's content, loaded with the agent (R63). */
  readonly skills = signal<AgentSkillsView | null>(null);
  readonly skillsLoading = signal(true);
  readonly skillsError = signal<string | null>(null);

  readonly tabs = computed(() => {
    const agent = this.agent();
    const skills = this.skills();
    const kind = agent ? agentKind(agent) : 'system';
    const icons = {
      chat: this.MessageSquare,
      prompt: this.ScrollText,
      skills: this.BookOpen,
      tools: this.Wrench,
      memory: this.Brain,
      evals: this.Gauge,
      model: this.Cpu,
    };
    const labels: Record<string, string> = {
      tools: `Tools${agent ? ` (${agent.toolDetails.length})` : ''}`,
      // A user agent counts its linked skills and the built-ins; skipped
      // skills don't count (R66).
      skills: `Skills${this.skillsCountLabel(kind, skills)}`,
    };
    return AGENT_TAB_ORDER.filter(
      (tab) => tab.id !== 'chat' || hasChatTab(kind),
    ).map((tab) => ({
      id: tab.id,
      label: labels[tab.id] ?? tab.label,
      icon: icons[tab.id],
    }));
  });

  private skillsCountLabel(
    kind: string,
    skills: AgentSkillsView | null,
  ): string {
    if (kind === 'user') {
      const library = this.librarySkills();
      const builtIn = this.everyAgentSkills();
      return library && builtIn
        ? ` (${skillsCount(this.agentInstructions(), library, builtIn.length)})`
        : '';
    }
    return skills ? ` (${skills.skills.length})` : '';
  }

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

    // A running task's Open asks for the Evals tab once the agent has loaded.
    effect(() => {
      const tab = this.pageState.requestedTab();
      if (!tab || this.loading() || this.agent()?.key !== this.agentKey())
        return;
      this.pageState.requestedTab.set(null);
      this.activeTab.set(tab);
    });

    // Keep the open question pointing at its latest result as polls land.
    effect(() => {
      this.runResults();
      untracked(() => this.syncSelection());
    });

    // The finished run belongs in the history list.
    this.tasks.finished$
      .pipe(
        filter(
          (t) => t.kind === 'eval-run' && t.key === untracked(this.agentKey),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (this.evalTab() === 'runs') this.loadEvalRuns();
      });

    // Try it mounts when first shown.
    effect(() => {
      if (this.activeTab() === 'chat') this.chatMounted.set(true);
    });

    // Reload whenever the selected agent changes.
    effect(() => {
      const key = this.agentKey();
      this.loading.set(true);
      this.error.set(null);
      this.chatMounted.set(false);
      this.librarySkills.set(null);
      this.pageState.reset();
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
      this.loadAgent(key, true);
      this.loadSkills(key);
    });
  }

  private loadSkills(key: string): void {
    this.skills.set(null);
    this.skillsLoading.set(true);
    this.skillsError.set(null);
    this.api.skills(key).subscribe({
      next: (view) => {
        // A late answer for an agent no longer on screen is dropped.
        if (this.agentKey() !== key) return;
        this.skills.set(view);
        this.skillsLoading.set(false);
      },
      error: (err) => {
        if (this.agentKey() !== key) return;
        this.skillsError.set(err?.error?.message ?? 'Backend unreachable');
        this.skillsLoading.set(false);
      },
    });
  }

  /** The owner's skills, for the Skills tab and the instruction chips. */
  readonly librarySkills = signal<SkillSummary[] | null>(null);
  readonly librarySkillsError = signal<string | null>(null);
  /** The names that exist, so a link to anything else shows as not found. */
  readonly knownLinkSet = computed(() =>
    knownLinks(
      this.librarySkills() ?? [],
      undefined,
      linkableBuiltInSkills(this.builtInSkills()),
    ),
  );

  private loadLibrarySkills(key: string): void {
    this.librarySkillsError.set(null);
    this.skillsApi.list().subscribe({
      next: (res) => {
        if (this.agentKey() === key) this.librarySkills.set(res.skills);
      },
      error: (err) => {
        if (this.agentKey() === key) {
          this.librarySkillsError.set(
            err?.error?.message ?? 'Backend unreachable',
          );
        }
      },
    });
  }

  /** Whether the user agent sets its own model. */
  readonly modelOverride = computed(() => {
    const agent = this.agent();
    return !!(agent?.live ?? agent?.draft)?.model;
  });

  /** The built-in skills, for the System Prompt links and a user agent's Skills tab. */
  readonly builtInSkills = signal<BuiltInSkillSummary[] | null>(null);
  /** The ones every agent gets (R75), which a user agent's Skills tab lists and counts. */
  readonly everyAgentSkills = computed(() => {
    const builtIn = this.builtInSkills();
    return builtIn ? includedInEveryAgent(builtIn) : null;
  });

  private loadBuiltInSkills(key: string): void {
    this.builtInSkills.set(null);
    this.skillsApi.listBuiltIn().subscribe({
      next: (res) => {
        if (this.agentKey() === key) this.builtInSkills.set(res.skills);
      },
      error: () => {
        if (this.agentKey() === key) this.builtInSkills.set([]);
      },
    });
  }

  /** Reload the owner's skills after the Skills tab changed one. */
  reloadLibrary(): void {
    this.loadLibrarySkills(this.agentKey());
    this.loadSkills(this.agentKey());
  }

  /** Reload the agent after the System Prompt saved its draft. */
  reloadAgent(): void {
    this.loadAgent(this.agentKey());
  }

  private loadAgent(key: string, initial = false): void {
    if (initial) {
      this.runsApi.list().subscribe({
        next: (res) => this.runs.set(res.runs),
        error: () => this.runs.set(null),
      });
    }
    this.api.getAgent(key).subscribe({
      next: (agent) => {
        if (this.agentKey() !== key) return;
        this.agent.set(agent);
        this.loading.set(false);
        if (initial) {
          this.activeTab.set(defaultAgentTab(agentKind(agent)));
        }
        if (agent.kind === 'user') {
          this.loadLibrarySkills(key);
          if (initial) this.loadBuiltInSkills(key);
        } else if (agent.prompt?.linksAllowed && initial) {
          // The assistant's prompt links built-in skills too.
          this.loadBuiltInSkills(key);
        }
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  /**
   * Why Try it can't run a user agent's draft: none of its draft's datasets
   * exists (R90). The backend refuses the same way.
   */
  protected tryBlocked(agent: AgentDetailModel): string | null {
    const missing = agent.missingDatasets ?? [];
    const datasets = agent.draft?.datasets ?? agent.datasets ?? [];
    return datasets.some((name) => !missing.includes(name))
      ? null
      : 'Add a dataset to this agent to try it.';
  }

  /** User agents only; built-in agents offer neither Publish nor Delete (R5). */
  readonly isUserAgent = computed(() => this.agent()?.kind === 'user');

  /**
   * Create agents (admin R25; ui.md 1.6): Edit, Publish and Delete, and in
   * the Evals tab running questions and the Executions sub-tab.
   */
  readonly canCreateAgents = computed(() => true);

  /** Edit and Delete on a user agent. */
  readonly canChange = computed(
    () => this.isUserAgent() && this.canCreateAgents(),
  );

  /** The workflows that use the agent, for the Used in line (R109). */
  readonly usedInWorkflows = computed(
    () => this.agent()?.usedInWorkflows ?? [],
  );
  /** The Used in line's text when no workflow uses the agent (R109). */
  readonly usedInEmpty = computed(() => {
    const agent = this.agent();
    return usedInEmptyText(agent ? agentKind(agent) : 'system');
  });

  /** Publish shows when there is no Live version or it has unpublished changes. */
  readonly canPublish = computed(() => {
    const agent = this.agent();
    return (
      agent?.kind === 'user' &&
      this.canCreateAgents() &&
      (agent.status !== 'live' || !!agent.hasUnpublishedChanges)
    );
  });

  /** The user agent's own instructions: the draft, else the Live version (R6). */
  readonly agentInstructions = computed(() => {
    const agent = this.agent();
    return (agent?.draft ?? agent?.live)?.instructions ?? '';
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
    () =>
      this.evalSets().find((set) => set.id === this.selectedSetId()) ?? null,
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

  /**
   * Live state of the current run, read from the `eval-run` background task of
   * this agent: the run goes on when the page is left and shows again when it
   * is opened (ADR-0047). The task's last value is the latest poll.
   */
  private readonly runTask = computed(() =>
    this.tasks.latest('eval-run', this.agentKey()),
  );
  private readonly runView = computed(
    () => this.runTask()?.result as EvalRunTick | undefined,
  );
  /** The run was asked for and its first answer has not come yet. */
  readonly runStarting = computed(() => {
    const task = this.runTask();
    return task?.status === 'running' && task.result === undefined;
  });
  readonly runError = computed<string | null>(() => {
    const task = this.runTask();
    if (!task) return null;
    if (task.status === 'failed') return task.detail;
    return this.runView()?.error ?? null;
  });
  readonly runStatus = computed<'idle' | 'running' | 'completed' | 'failed'>(
    () => {
      const task = this.runTask();
      if (!task || task.status === 'stopped') return 'idle';
      if (task.status === 'running') {
        return task.result === undefined ? 'idle' : 'running';
      }
      if (task.status === 'failed') return 'failed';
      return this.runView()?.status ?? 'completed';
    },
  );
  readonly runResults = computed<AgentEvalCaseResult[]>(
    () => this.runView()?.results ?? [],
  );
  readonly runCurrentQuestion = computed(
    () => this.runView()?.currentQuestion ?? null,
  );
  readonly runDatasets = computed(() => this.runView()?.datasets ?? []);

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

    const key = this.agentKey();
    const name = this.agent()?.name ?? key;
    // The task is subscribed at the root, so leaving this page neither stops
    // the run nor its polling; `tasks.latest` shows it again on return.
    this.tasks.start<EvalRunTick>({
      kind: 'eval-run',
      key,
      title: `Running evals · ${name}`,
      work: () => this.evalRunWork(key, datasourceId, caseIds),
      onValue: (view, task) => {
        const total = view.totalCases || caseIds.length;
        const done = view.results?.length ?? 0;
        if (!view.ok || !total) return;
        this.tasks.update(task.id, {
          progress: { done, total },
          detail: `${done} of ${total} questions`,
        });
      },
      outcome: (last) => evalRunOutcome(last, name),
      open: () => this.openEvals(key),
      // The page shows its own run state and errors; toast only when away.
      toast: () => !(this.alive && this.agentKey() === key),
    });
  }

  /**
   * Start the job, then poll it every 1.5 s until it leaves `running`; every
   * poll is emitted, so each question lands as it finishes.
   */
  private evalRunWork(
    key: string,
    datasourceId: string,
    caseIds: string[],
  ): Observable<EvalRunTick> {
    return this.api.startEvalRun(key, datasourceId, caseIds).pipe(
      switchMap((res): Observable<EvalRunTick> => {
        if (!res.ok || !res.jobId) {
          return of({ ok: false, message: res.message });
        }
        const jobId = res.jobId;
        // The run is under way as soon as it starts: show it with no result
        // yet, then read it back every 1.5 s until it ends.
        return timer(1500, 1500).pipe(
          concatMap(() => this.api.getEvalRun(key, jobId)),
          takeWhile((view) => view.ok && view.status === 'running', true),
          startWith<EvalRunTick>({
            ok: true,
            message: res.message,
            status: 'running',
            results: [],
            totalCases: caseIds.length,
          }),
        );
      }),
    );
  }

  /** The task's Open: this agent's page on its Evals tab. */
  private openEvals(key: string): void {
    this.pageState.requestedTab.set('evals');
    this.nav.openAgentByKey(key);
    // The shell refused (unsaved edits): don't leave the request for later.
    if (this.nav.activeAgentKey() !== key)
      this.pageState.requestedTab.set(null);
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
    this.alive = false;
    this.pageState.reset();
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
