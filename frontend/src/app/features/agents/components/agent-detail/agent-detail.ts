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
  BookOpen,
  Bot,
  Brain,
  CircleCheck,
  CircleMinus,
  CircleX,
  Cpu,
  Network,
  Trash2,
  Gauge,
  Loader2,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
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
  AgentSkillsView,
  AgentsApiService,
  EvalJudgeChoice,
  EvalRunView,
  EvalStatus,
} from '../../services/agents-api.service';
import { EvalSelectionService } from '../../services/eval-selection.service';
import {
  EVAL_STATUS_LABELS,
  checkResultFor,
  checkStatus,
  evalRunSummary,
  resultStatus,
  runCounts,
  runHeadline,
  runVerdict,
} from '../../services/eval-run.util';
import { EvalRunSummaryTables } from '../eval-run-summary/eval-run-summary';
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
import { AgentSkills } from '../agent-skills/agent-skills';
import { AgentGraph } from '../agent-graph/agent-graph';
import { AgentLlmConfig } from '../agent-llm-config/agent-llm-config';
import { AgentToolLinks } from '../agent-tool-links/agent-tool-links';
import { AgentChatBox } from '../agent-chat-box/agent-chat-box';
import { AgentSkillsInline } from '../agent-skills-inline/agent-skills-inline';
import { AgentSystemPrompt } from '../agent-system-prompt/agent-system-prompt';
import { AgentPageState } from '../../services/agent-page-state.service';
import {
  AGENT_TAB_ORDER,
  AgentTabId,
  defaultAgentTab,
  hasChatTab,
  includedInEveryAgent,
  skillsCount,
} from '../../services/agent-page.util';
import { agentKind } from '../../services/agent-hub.util';
import { officialGraphInput } from '../../services/official-links';
import { knownLinks, linkableBuiltInSkills } from '../../services/prompt-links';
import {
  BuiltInSkillSummary,
  SkillSummary,
  SkillsApiService,
} from '../../services/skills-api.service';

type AgentTab = AgentTabId;
/** Sub-tabs inside the evals tab. */
type EvalTab = 'questions' | 'runs';

@Component({
  selector: 'app-agent-detail',
  imports: [
    LucideAngularModule,
    AgentSkills,
    AgentGraph,
    AgentLlmConfig,
    AgentToolLinks,
    AgentChatBox,
    AgentSkillsInline,
    AgentSystemPrompt,
    EvalRunSummaryTables,
  ],
  templateUrl: './agent-detail.html',
  styleUrl: './agent-detail.scss',
})
export class AgentDetail implements OnDestroy {
  readonly ArrowLeft = ArrowLeft;
  readonly BookOpen = BookOpen;
  readonly Bot = Bot;
  readonly Brain = Brain;
  readonly CircleCheck = CircleCheck;
  readonly CircleMinus = CircleMinus;
  readonly CircleX = CircleX;
  readonly Cpu = Cpu;
  readonly Network = Network;
  readonly Gauge = Gauge;
  readonly Loader2 = Loader2;
  readonly ListChecks = ListChecks;
  readonly MessageSquare = MessageSquare;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly Pencil = Pencil;
  readonly ChevronRight = ChevronRight;
  readonly Download = Download;
  readonly Play = Play;
  readonly Trash2 = Trash2;
  readonly ScrollText = ScrollText;
  readonly Upload = Upload;
  readonly Wrench = Wrench;

  private readonly api = inject(AgentsApiService);
  private readonly skillsApi = inject(SkillsApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly evalSelection = inject(EvalSelectionService);
  private readonly toast = inject(ToastService);
  private readonly pageState = inject(AgentPageState);

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
  /** Edit a user agent; the shell opens the agent editor on its draft (R54). */
  readonly edit = output<AgentDetailModel>();
  /** An admin's Edit on a built-in skill; the shell opens its editor. */
  readonly openBuiltInSkill = output<string>();
  /** True while a session is being created from this agent. */
  readonly starting = input(false);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly agent = signal<AgentDetailModel | null>(null);
  readonly activeTab = signal<AgentTab>('prompt');
  /** The Chat Box mounts the first time it is shown, then stays. */
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
      graph: this.Network,
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

    // The Chat Box mounts when first shown.
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
      this.judge.set('off');
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

  /** The owner's skills, for the Graph tab and the instruction chips. */
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

  /**
   * The Graph tab of an Official agent (R105): the skills it gets and every
   * one of its tools, always on. Null while the built-in skills load.
   */
  readonly officialGraph = computed(() => {
    const agent = this.agent();
    const skills = this.builtInSkills();
    return agent && skills ? officialGraphInput(agent, skills) : null;
  });

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
    this.api.getAgent(key).subscribe({
      next: (agent) => {
        if (this.agentKey() !== key) return;
        this.agent.set(agent);
        this.loading.set(false);
        if (initial) this.activeTab.set(defaultAgentTab(agentKind(agent)));
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

  readonly statusLabels = EVAL_STATUS_LABELS;
  readonly resultStatus = resultStatus;
  readonly runHeadline = runHeadline;
  readonly runVerdict = runVerdict;

  /** A check's status on a finished question; undefined when it has none. */
  checkStatusIn(
    result: AgentEvalCaseResult,
    checkId: string,
  ): EvalStatus | undefined {
    const check = checkResultFor(result, checkId);
    return check ? checkStatus(check) : undefined;
  }

  /** A run's tables by category and criterion, once a question finished. */
  readonly runSummary = evalRunSummary;

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

  /** Whether the run asks the LLM judge to score its judge checks. */
  readonly judge = signal<EvalJudgeChoice>('off');

  onJudgeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.judge.set(value === 'on' ? 'on' : 'off');
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
  private readonly runResultCounts = computed(() =>
    runCounts(this.runResults()),
  );
  readonly passedCount = computed(() => this.runResultCounts().passed);
  readonly notScoredCount = computed(() => this.runResultCounts().notScored);

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

    this.api
      .startEvalRun(this.agentKey(), datasourceId, caseIds, this.judge())
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
        this.refreshListedRun(view);
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

  /**
   * Keep the run's card in Executions current while it goes, so its headline
   * and summary follow its finished questions (R151).
   */
  private refreshListedRun(
    view: { ok: boolean; message: string } & Partial<EvalRunView>,
  ): void {
    // The poll's own `ok` and `message` are not part of the run.
    const { ok: _ok, message: _message, ...run } = view;
    const runs = this.evalRuns();
    const index = runs.findIndex((listed) => listed.jobId === run.jobId);
    if (index === -1) return;
    const next = [...runs];
    next[index] = { ...runs[index], ...run };
    this.evalRuns.set(next);
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
    this.pageState.reset();
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
