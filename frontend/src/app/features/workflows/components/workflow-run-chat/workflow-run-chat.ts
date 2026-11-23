import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  Archive,
  Brain,
  ChevronDown,
  CircleCheck,
  Database,
  Image as ImageIcon,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  LucideAngularModule,
  MessageSquare,
  MessageSquareReply,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  SquarePen,
  ToggleRight,
  Type,
  Workflow,
  X,
} from 'lucide-angular';
import { ExecutionId } from '../../../../shared/execution-id/execution-id';
import { RunArtifactCard } from '../../../runs/components/run-artifact-card/run-artifact-card';
import { RunDashboardCard } from '../../../runs/components/run-dashboard-card/run-dashboard-card';
import {
  ConversationTurn,
  WorkflowConversation,
} from '../../services/workflow-conversation';
import {
  ChatHistoryItem,
  ChatHistoryNav,
} from '../../../../shared/components/chat-history-nav/chat-history-nav';
import { ArtifactSummary } from '../../../artifacts/models/artifact.model';
import { ArtifactsApiService } from '../../../artifacts/services/artifacts-api.service';
import { ArtifactsNavState } from '../../../artifacts/services/artifacts-nav-state';
import { WorkflowsNavState } from '../../services/workflows-nav-state';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import {
  DatasourceKind,
  kindLabel,
} from '../../../datasources/models/datasource.model';
import { ReadinessHistory } from '../../../data-readiness/components/readiness-history/readiness-history';
import {
  ReadinessPanelItem,
  ReadinessReportRef,
  VisualEvent,
} from '../../../sessions/models/session.model';
import { PanelReadinessView } from '../../../sessions/components/panel-readiness-view/panel-readiness-view';
import {
  readinessPanelItemId,
  readinessPanelTitle,
} from '../../../sessions/models/readiness.model';
import { RunVisual } from '../../../runs/components/run-visual/run-visual';
import { RunVisualsState } from '../../../runs/services/run-visuals-state';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import {
  answerHasQueries,
  WorkflowInputField,
  WorkflowRun,
} from '../../models/workflow.model';
import { WorkflowRunInputRequired } from '../workflow-run-input-required/workflow-run-input-required';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import { WorkflowRunTeam } from '../workflow-run-team/workflow-run-team';
import { RelayQueryOpen } from '../workflow-run-relay/workflow-run-relay';
import { recordIndexOf } from '../../services/team-relay';
import { AgentActivity } from '../agent-activity/agent-activity';
import { activitySteps } from '../../services/agent-activity';
import { WorkflowRunStory } from '../workflow-run-story/workflow-run-story';
import { WorkflowRunAttachments } from './workflow-run-attachments';
import { RunComposer } from '../run-composer/run-composer';
import { RunMessage } from '../run-message/run-message';
import { RunOptionCards } from '../run-option-cards/run-option-cards';
import {
  IntakeKind,
  IntakeOption,
  artifactOption,
  askText,
  composerPlaceholder,
  continueLabel,
  datasetOption,
  emptyHint,
  hasInputValue,
  intakeKind,
  leadVoice,
  missingFields,
  optionLabel,
  pendingPlaceholder,
  promptField,
  refusalText,
  shownOptions,
  typedOption,
} from './run-intake.util';
import {
  addImageFiles,
  dragHasFiles,
  imageFilesOf,
} from './composer-images.util';
import { WorkflowRunsApiService } from '../../services/workflow-runs-api.service';
import {
  IMAGE_ACCEPT,
  isImageDataUrl,
} from '../../services/workflow-input-validation';
import {
  IMAGES_FIELD,
  canRunFromPage,
  runOutputEntries,
  runStatusLine,
} from '../../services/workflows.util';

/** The workflow a saved dashboard is mapped in, and its artifact field. */
const MAP_WORKFLOW_ID = 'map-dashboard-data';
/** Avery, the Chief of Staff: a workflow she runs is a never-ending conversation. */
const AVERY_AGENT_KEY = 'chief-of-staff';
const MAP_ARTIFACT_FIELD = 'artifact';

/** One turn of the conversation before a run starts (the intake). */
interface ChatEntry {
  id: number;
  /** Each Send from an empty composer starts a round. */
  round: number;
  from: 'user' | 'agent';
  text: string;
  /** A user turn: the names picked, as chips. */
  chips?: string[];
  /** The message that filled the run's prompt. */
  question?: boolean;
  /** An agent turn that asks for this field. */
  field?: string;
  /** An agent turn that says the run was refused. */
  error?: boolean;
}

/** The field the agent waits on, and the turn that asked for it. */
interface PendingAsk {
  field: WorkflowInputField;
  kind: IntakeKind;
  entryId: number;
}

/**
 * The Chat column of a workflow's Run panel, under the canvas (workflows
 * R13, R21; ui.md 4.4b): the question asked, the waiting card, the agent
 * working live and the answer, then the composer: the run's input with
 * Execute and Stop, or, under a stored answer, Follow up; How it ran under
 * an ended run's answer. Each step's state is on the canvas beside it. It shares its state with the page through the
 * designer.
 */
@Component({
  selector: 'app-workflow-run-chat',
  imports: [
    AnswerView,
    NgTemplateOutlet,
    RunComposer,
    RunMessage,
    RunOptionCards,
    ExecutionId,
    LucideAngularModule,
    MarkdownPipe,
    PanelReadinessView,
    ReadinessHistory,
    RunVisual,
    WorkflowRunAttachments,
    WorkflowRunInputRequired,
    WorkflowRunStory,
    WorkflowRunTeam,
    AgentActivity,
    ChatHistoryNav,
    RunArtifactCard,
    RunDashboardCard,
  ],
  providers: [WorkflowConversation],
  templateUrl: './workflow-run-chat.html',
  styles: `
    /* A checkbox drawn as a switch (the inputs menu's options). */
    .run-switch {
      appearance: none;
      position: relative;
      flex: none;
      width: 30px;
      height: 18px;
      margin: 0;
      border-radius: 9999px;
      background-color: var(--qti-border-strong);
      cursor: pointer;
      transition: background-color 120ms ease;
    }
    .run-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background-color: var(--qti-surface);
      transition: transform 120ms ease;
    }
    .run-switch:checked {
      background-color: var(--qti-primary);
    }
    .run-switch:checked::after {
      transform: translateX(12px);
      background-color: var(--qti-on-primary);
    }
    .run-switch:focus-visible {
      outline: 2px solid var(--qti-focus);
      outline-offset: 2px;
    }
  `,
  host: {
    class: 'relative flex min-h-0 flex-col',
    'data-testid': 'workflow-run-chat',
    '(document:keydown.escape)': 'closeMenu()',
  },
})
export class WorkflowRunChat {
  protected readonly hasQueries = answerHasQueries;
  protected readonly Archive = Archive;
  protected readonly Brain = Brain;
  protected readonly CircleCheck = CircleCheck;
  protected readonly Loader2 = Loader2;
  protected readonly MessageSquare = MessageSquare;
  protected readonly MessageSquareReply = MessageSquareReply;
  protected readonly RotateCcw = RotateCcw;
  protected readonly Send = Send;
  protected readonly ChevronDown = ChevronDown;
  protected readonly Database = Database;
  protected readonly ImageIcon = ImageIcon;
  protected readonly ImagePlus = ImagePlus;
  protected readonly LayoutDashboard = LayoutDashboard;
  protected readonly ShieldCheck = ShieldCheck;
  protected readonly Type = Type;
  protected readonly optionLabel = optionLabel;
  protected readonly continueLabel = continueLabel;
  protected readonly Square = Square;
  protected readonly SquarePen = SquarePen;
  protected readonly Workflow = Workflow;
  protected readonly X = X;

  /**
   * `panel`: the Run panel's Chat beside the canvas. `business`: the page's
   * Business view (R38): the same chat, each message a run of the workflow,
   * with the agents' thread but no live tool calls or How it ran; a run's
   * details open in the Builder view.
   */
  readonly variant = input<'panel' | 'business'>('panel');
  protected readonly business = computed(() => this.variant() === 'business');

  /**
   * The chat reads the whole thread of earlier turns: always in the Business
   * view, and for Answer a Business Question (orchestrated) in either view,
   * since that conversation never ends.
   */
  protected readonly threaded = computed(
    () => this.business() || this.isAveryWorkflow(),
  );
  // Answer a Business Question (orchestrated) and (Avery + Michael): any
  // workflow whose step runs Avery (workflows R45).
  private readonly isAveryWorkflow = computed(
    () =>
      this.designer
        .workflow()
        ?.steps.some((step) => step.agent?.key === AVERY_AGENT_KEY) ?? false,
  );

  /** The shown run is an ended, not archived run of Avery's conversation. */
  protected readonly averyOpen = computed(() => {
    const status = this.designer.runResult()?.status;
    return (
      this.isAveryWorkflow() &&
      this.designer.run() !== null &&
      this.designer.run()?.archivedAt === undefined &&
      !this.designer.running() &&
      (status === 'success' || status === 'failed' || status === 'stopped')
    );
  });

  /** The shown run belongs to an archived Avery conversation (read-only). */
  protected readonly averyArchived = computed(
    () =>
      this.isAveryWorkflow() &&
      this.designer.run() !== null &&
      this.designer.run()?.archivedAt !== undefined &&
      !this.designer.running(),
  );

  protected readonly averyText = signal('');
  protected readonly averyError = signal<string | null>(null);
  protected readonly averyBusy = signal(false);
  protected readonly averyNotice = signal<string | null>(null);

  protected sendAvery(): void {
    const text = this.averyText().trim();
    if (!text || this.designer.running()) return;
    this.averyError.set(null);
    this.averyNotice.set(null);
    this.averyText.set('');
    this.designer.followUp(text);
  }

  protected archiveConversation(): void {
    const run = this.designer.run();
    if (run === null || this.averyBusy()) return;
    this.averyBusy.set(true);
    this.averyError.set(null);
    this.runsApi.archive(run.id).subscribe({
      next: () => {
        this.averyBusy.set(false);
        this.newQuestion();
        this.averyNotice.set('Conversation archived');
      },
      error: (err: unknown) => {
        this.averyBusy.set(false);
        this.averyError.set(this.messageOf(err, 'Could not archive'));
      },
    });
  }

  protected unarchiveConversation(): void {
    const run = this.designer.run();
    if (run === null || this.averyBusy()) return;
    this.averyBusy.set(true);
    this.averyError.set(null);
    this.runsApi.unarchive(run.id).subscribe({
      next: () => {
        this.runsApi.getRun(run.id).subscribe({
          next: (fresh) => {
            this.averyBusy.set(false);
            this.designer.run.set(fresh);
          },
          error: () => {
            this.averyBusy.set(false);
            this.designer.run.set({ ...run, archivedAt: undefined });
          },
        });
      },
      error: (err: unknown) => {
        this.averyBusy.set(false);
        this.averyError.set(this.messageOf(err, 'Could not unarchive'));
      },
    });
  }

  private messageOf(err: unknown, fallback: string): string {
    const message = (err as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' && message !== '' ? message : fallback;
  }

  /**
   * Business view only: show the run in the Builder view, with this step's
   * dialog open when a step id is given (an agent's See its data).
   */
  readonly openInBuilder = output<string | null>();

  /** An agent's See its data: its dialog here, or in Builder from the Business view. */
  protected openStep(id: string): void {
    if (this.business()) this.openInBuilder.emit(id);
    else this.designer.openNode(id);
  }

  /**
   * A teammate's query picked in Avery's relay (ui.md 4.4b *relay*): that
   * query opens in the query inspector; while the answer is not stored yet
   * (the run still works), the step's dialog opens instead.
   */
  protected openTeamQuery(event: {
    stepId: string;
    query: RelayQueryOpen;
  }): void {
    const data = this.designer.runResult()?.answer?.data;
    const index = recordIndexOf(data, event.query.step);
    if (index >= 0) this.designer.openQuery(index, event.query.opener);
    else this.openStep(event.stepId);
  }

  protected readonly designer = inject(WorkflowDesigner);
  protected readonly visuals = inject(RunVisualsState);
  private readonly artifactsApi = inject(ArtifactsApiService);
  private readonly runsApi = inject(WorkflowRunsApiService);
  private readonly artifactsNav = inject(ArtifactsNavState);
  private readonly workflowsNav = inject(WorkflowsNavState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  /** The chat follows the run's newest text while the user stays near its end. */
  private stickToEnd = true;
  /** The run whose question and answer were last scrolled into view. */
  private shownRunId: string | null = null;

  constructor() {
    // The Business view reads the whole conversation (R38).
    effect(() => {
      const on = this.threaded();
      untracked(() => this.conversation.active.set(on));
    });
    // While a run streams, keep its newest text in view; once it ends, show
    // its question and the start of its answer.
    effect(() => {
      this.designer.streamingText();
      this.designer.reasoning();
      this.designer.toolCalls().length;
      const status = this.designer.runResult()?.status ?? null;
      const runId = this.designer.run()?.id ?? null;
      untracked(() => setTimeout(() => this.follow(status, runId)));
    });
    // Execute workflow on the canvas, New question, Run again: focus the
    // composer, once per request, holding the prompt the input holds now.
    effect(() => {
      const request = this.designer.runFormRequest();
      if (request === 0) return;
      untracked(() => {
        this.designer.runFormRequest.set(0);
        if (this.pending() === null) this.syncDraft();
        setTimeout(() => this.focusComposer());
      });
    });
    // Another workflow (or the same one opened again): a fresh conversation.
    effect(() => {
      this.designer.workflow();
      untracked(() => {
        this.resetIntake();
        this.syncDraft();
      });
    });
    // A run the intake started: its turns stay above it once it has an id.
    effect(() => {
      const runId = this.designer.runId();
      untracked(() => {
        if (runId !== null && this.awaitingStart()) {
          this.transcriptRunId.set(runId);
          this.awaitingStart.set(false);
        }
      });
    });
    // A refused start (the form's own check, or the server's): the agent
    // says why and asks again for the first field at fault, whoever started
    // the run (the message box, or the home page's Ask on load). A refusal
    // with field errors bumps `invalidFocusRequest`; one without sets a new
    // `runError`.
    effect(() => {
      const bump = this.designer.invalidFocusRequest();
      const message = this.designer.runError();
      untracked(() => {
        const fresh =
          bump > 0 || (message !== null && message !== this.reportedError);
        this.reportedError = message;
        if (bump > 0) {
          this.designer.invalidFocusRequest.set(0);
          setTimeout(() => this.focusComposer());
        }
        if (!fresh) return;
        this.awaitingStart.set(false);
        const errors = this.designer.inputErrors();
        this.onRefused(
          [...new Set([message, ...errors.map((e) => e.message)])].filter(
            (m): m is string => m !== null,
          ),
          errors.find((e) => e.field !== null)?.field ?? null,
        );
      });
    });
    // A workflow with an artifact field: load the artifacts it offers.
    effect(() => {
      const workflow = this.designer.workflow();
      const wants = workflow?.input.some(
        (field) => !field.hidden && field.type === 'artifact',
      );
      if (!wants) return;
      untracked(() =>
        this.artifactsApi.list().subscribe({
          next: (artifacts) => this.artifacts.set(artifacts),
          error: () => this.artifacts.set([]),
        }),
      );
    });
  }

  /** Scrolling the chat by hand: it follows the run again only near its end. */
  protected onLogScroll(): void {
    const el = this.log()?.nativeElement;
    if (el === undefined) return;
    this.stickToEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  /** Business view: the earlier questions of this conversation (R38). */
  protected readonly conversation = inject(WorkflowConversation);

  /** The conversation navigation's questions; empty under two (R38). */
  protected readonly navItems = computed<ChatHistoryItem[]>(() => {
    const current = this.designer.shownQuestion();
    const items: ChatHistoryItem[] = this.conversation
      .earlier()
      .map((turn) => ({ id: turn.runId, label: turn.question }));
    if (current) items.push({ id: 'current', label: current });
    return items.length >= 2 ? items : [];
  });

  /** A question picked in the navigation: the chat stops following the run. */
  protected onHistoryPicked(): void {
    this.stickToEnd = false;
  }

  /** The chat's scrolling element, for the conversation navigation. */
  protected readonly logElement = computed(() => this.log()?.nativeElement);

  /** A figure of an earlier turn: its query opens in the sheet, from that run. */
  protected inspectEarlierQuery(turn: ConversationTurn, index: number): void {
    this.designer.openQuery(index, window.document.activeElement, turn.run);
  }

  private follow(status: string | null, runId: string | null): void {
    const el = this.log()?.nativeElement;
    if (el === undefined) return;
    if (status === 'running') {
      if (this.shownRunId !== null) {
        this.shownRunId = null;
        this.stickToEnd = true;
      }
      if (this.stickToEnd) el.scrollTop = el.scrollHeight;
      return;
    }
    if (runId === null || runId === this.shownRunId) return;
    this.shownRunId = runId;
    const question = el.querySelector<HTMLElement>(
      '[data-testid="workflow-run-question"]',
    );
    el.scrollTop =
      question === null
        ? 0
        : question.getBoundingClientRect().top -
          el.getBoundingClientRect().top +
          el.scrollTop -
          8;
  }

  private readonly composer = viewChild<RunComposer>('composer');

  private focusComposer(): void {
    this.composer()?.focus();
  }

  /** Only a workflow with an input runs from its page (R21). */
  protected readonly canRun = computed(() => {
    const workflow = this.designer.workflow();
    return workflow !== null && canRunFromPage(workflow);
  });

  /** A visual action stored the run: show it as it is now. */
  protected readonly applyRun = (run: WorkflowRun): void =>
    this.designer.run.set(run);

  // No "Generate interactive visuals" here: a workflow that wants visuals
  // makes them in a step of its own, with a specialised agent (ui.md 4.4b).
  // Visuals a run already has still open under the answer.

  /** A visual card's View: open that visual under the answer. */
  /** A figure chip or query row: the query opens in the sheet beside the answer. */
  protected inspectQuery(index: number): void {
    this.designer.openQuery(index, window.document.activeElement);
  }

  /** A card's Open: the visual opens in the side panel (visuals R42). */
  protected viewVisual(event: VisualEvent): void {
    const run = this.designer.run();
    if (run !== null) this.visuals.view(run, event);
  }

  /** A gate's Open visual: the visual Ryan built opens in the side panel, answer or not. */
  protected openGateVisual(visualId: string): void {
    const found = this.designer
      .run()
      ?.visualizations?.find((visual) => visual.id === visualId);
    this.viewVisual({
      visualId,
      version: found?.currentVersion ?? 1,
      title: found?.title ?? '',
      action: 'created',
    });
  }

  /** The shown answer made a visual: its card carries Saved to Artifacts and Map to data. */
  protected readonly hasArtifactCard = computed(
    () =>
      this.designer.run() !== null &&
      this.designer.runResult()?.answer?.visual !== undefined,
  );

  /**
   * The scorecard opened from the run's readiness card (data-readiness R5),
   * kept with the run it belongs to: a new run shows none.
   */
  private readonly scorecard = signal<{
    runId: string | null;
    item: ReadinessPanelItem;
  } | null>(null);
  protected readonly shownScorecard = computed(() => {
    const open = this.scorecard();
    return open !== null && open.runId === this.designer.runId()
      ? open.item
      : null;
  });

  /**
   * Open scorecard: the run's saved panel item for the report, else the same
   * item the orchestrator writes; always a fresh object, so a scorecard
   * showing a past assessment comes back to this one.
   */
  protected openScorecard(ref: ReadinessReportRef): void {
    const id = readinessPanelItemId(ref.reportId);
    const saved = this.designer
      .run()
      ?.panelItems?.find(
        (item): item is ReadinessPanelItem =>
          item.kind === 'readiness' && item.id === id,
      );
    this.scorecard.set({
      runId: this.designer.runId(),
      item: saved
        ? { ...saved }
        : {
            id,
            kind: 'readiness',
            title: readinessPanelTitle(ref.datasourceName),
            shownAt: ref.generatedAt,
            reportId: ref.reportId,
          },
    });
  }

  protected closeScorecard(): void {
    this.scorecard.set(null);
  }

  /** The agent step running now, while the run streams: its live block shows. */
  protected readonly liveAgentStep = computed(
    () =>
      this.designer.running() &&
      this.designer
        .runPanelSteps()
        .some((step) => step.kind === 'agent' && step.status === 'running'),
  );

  /**
   * The running agent step has a row in the team, where its thought and
   * steps show; a step with no persona shows them in the live block.
   */
  protected readonly liveStepInTeam = computed(() =>
    [...this.designer.agentStories().values()].some(
      (story) => story.state === 'active',
    ),
  );

  /** The running step's calls as plain-language steps, for the live block. */
  protected readonly liveActivity = computed(() =>
    activitySteps(
      this.designer.toolCalls().map((call) => ({ ...call, tool: call.name })),
      true,
    ),
  );

  /** A query line of the live block: open the running step's queries. */
  protected openRunningStep(): void {
    const step = this.designer
      .runPanelSteps()
      .find((s) => s.kind === 'agent' && s.status === 'running');
    if (step) this.openStep(step.id);
  }

  /**
   * A code step running with progress of its own (Review a Website's pages,
   * agents.md 5.19): its title, its latest progress line and the five
   * before it, newest first.
   * Its progress arrives as the run's reasoning; an agent step shows it as
   * Thinking instead. Null when no code step reports progress.
   */
  protected readonly liveCodeProgress = computed(() => {
    if (!this.designer.running() || this.liveAgentStep()) return null;
    const step = this.designer
      .runPanelSteps()
      .find((s) => s.kind === 'code' && s.status === 'running');
    const lines = this.designer
      .reasoning()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!step || !lines.length) return null;
    return {
      title: step.title,
      latest: lines[lines.length - 1],
      recent: lines.slice(-6, -1).reverse(),
    };
  });

  /**
   * The run's input shows only while no run is shown (2026-11-20: runs have
   * no follow-up any more). Under a run, running, waiting or ended, the
   * conversation takes the whole column; New question or Run again brings
   * the input back.
   */
  protected readonly composerShown = computed(
    () => this.designer.runResult() === null && !this.designer.running(),
  );

  /** The last file refused when adding images; cleared by the next add or remove. */
  protected readonly attachError = signal<string | null>(null);

  /** A file is being dragged over the composer. */
  protected readonly dragging = signal(false);

  /** The `images` field of the workflow (reference images), when it has one. */
  protected readonly imagesField = computed(
    () =>
      this.designer
        .workflow()
        ?.input.find((f) => !f.hidden && f.type === 'images') ?? null,
  );

  /** The single `image` field, which paste and drop fill when there is no `images` field. */
  private readonly imageField = computed(
    () =>
      this.designer
        .workflow()
        ?.input.find((f) => !f.hidden && f.type === 'image') ?? null,
  );

  /** Whether the shown composer takes pasted or dropped images. */
  private readonly takesImages = computed(
    () => this.imagesField() !== null || this.imageField() !== null,
  );

  /** The file name each image field shows, by field name. */
  private readonly imageNames = signal<Record<string, string>>({});

  /** The stored artifacts an `artifact` field offers. */
  private readonly artifacts = signal<ArtifactSummary[]>([]);

  /** The artifacts of the field's kinds (every kind when it names none). */
  protected artifactChoices(field: WorkflowInputField): ArtifactSummary[] {
    const kinds = field.artifactKinds;
    const all = this.artifacts();
    if (!kinds || kinds.length === 0) return all;
    return all.filter((artifact) => kinds.includes(artifact.kind));
  }

  /** An artifact was picked (or None): it replaces the field it is required without. */
  protected onArtifact(field: WorkflowInputField, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.designer.setInput(field.name, value);
    if (value !== '') this.clearPeer(field);
  }

  /** Empties the field `field` is required without, and its file picker. */
  private clearPeer(field: WorkflowInputField): void {
    const peer = field.requiredWithout;
    if (peer === undefined) return;
    this.designer.setInput(peer, '');
    this.imageNames.update((names) => ({ ...names, [peer]: '' }));
    const control = this.host.nativeElement.querySelector<HTMLInputElement>(
      `[id="${this.inputId(peer)}"]`,
    );
    if (control !== null && control.type === 'file') control.value = '';
  }

  /**
   * The artifact the shown run saved (Dashboard Image to Artifact saves the
   * dashboard it read); null for a run that saved none.
   */
  protected readonly savedArtifactId = computed(() => {
    const result = this.designer.runResult();
    const id = result?.output?.['artifactId'];
    return result !== null &&
      result.status === 'success' &&
      typeof id === 'string' &&
      id !== ''
      ? id
      : null;
  });

  protected openSavedArtifact(id: string): void {
    this.artifactsNav.openArtifact(id);
  }

  /** Opens Map a Dashboard to Data with the saved dashboard picked. */
  protected mapSavedArtifact(id: string): void {
    this.designer.prefillOnLoad({ [MAP_ARTIFACT_FIELD]: id });
    this.workflowsNav.openWorkflow(MAP_WORKFLOW_ID);
  }

  /** The line under the workflow's name before a run. */
  protected readonly emptyHint = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? '' : emptyHint(workflow);
  });

  /**
   * The run ended with an answer: the answer leads and how the run went
   * follows it (ui.md 4.4b, *Answer first*).
   */
  protected readonly answerFirst = computed(() => {
    const result = this.designer.runResult();
    return (
      !!result?.answer &&
      result.status !== 'running' &&
      result.status !== 'suspended' &&
      !this.designer.running()
    );
  });
  protected readonly runStatus = computed(() => {
    const result = this.designer.runResult();
    return result === null ? '' : runStatusLine(result);
  });
  /** The final output, field by field: for a run without an answer (code-only). */
  protected readonly runOutput = computed(() => {
    const result = this.designer.runResult();
    if (result === null || result.answer !== undefined) return [];
    return runOutputEntries(result.output);
  });

  /** The latest line of the agent's reasoning, for the Thinking block. */
  protected readonly reasoningSnippet = computed(() => {
    const text = this.designer.reasoning().replace(/\s+/g, ' ').trim();
    return text.length > 120 ? `…${text.slice(-120)}` : text;
  });

  protected inputId(name: string): string {
    return `workflow-input-${name}`;
  }

  /** The id (and test id) of a field's error message. */
  protected errorId(name: string): string {
    return `workflow-input-error-${name}`;
  }

  /** A field's error from the last refused Execute; null when it has none. */
  protected fieldError(name: string): string | null {
    const errors = this.designer.fieldErrors();
    return Object.hasOwn(errors, name) ? errors[name] : null;
  }

  /** `aria-describedby` of a field's control: its error, while it has one. */
  protected describedBy(name: string): string | null {
    return this.fieldError(name) !== null ? this.errorId(name) : null;
  }

  protected onInput(name: string, event: Event): void {
    const value = (
      event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    ).value;
    this.designer.setInput(name, value);
  }

  /** The file types an image field's picker offers. */
  protected readonly imageAccept = IMAGE_ACCEPT;

  /** The image a field holds, to preview it; null when it holds none. */
  protected imagePreview(name: string): string | null {
    const values = this.designer.inputValues();
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    return isImageDataUrl(value) ? value : null;
  }

  /** The name of the file an image field holds; '' when it holds none. */
  protected imageName(name: string): string {
    const names = this.imageNames();
    return Object.hasOwn(names, name) ? names[name] : '';
  }

  /**
   * An image field's file was picked: the form holds it as a `data:` URL,
   * which is what a run sends (api.md 118). Clearing the picker clears it.
   */
  protected onImage(name: string, event: Event): void {
    void this.setImageFile(name, (event.target as HTMLInputElement).files?.[0]);
  }

  /** Holds `file` as an image field's value (nothing clears it); resolves once read. */
  private setImageFile(name: string, file: File | undefined): Promise<void> {
    if (!file) {
      this.imageNames.update((names) => ({ ...names, [name]: '' }));
      this.designer.setInput(name, '');
      return Promise.resolve();
    }
    const reader = new FileReader();
    const done = new Promise<void>((resolve) => {
      reader.onloadend = () => resolve();
    });
    reader.onload = () => {
      this.imageNames.update((names) => ({ ...names, [name]: file.name }));
      this.designer.setInput(
        name,
        typeof reader.result === 'string' ? reader.result : '',
      );
      // An image picked replaces the field this one is required without.
      const field = this.designer
        .workflow()
        ?.input.find((f) => f.name === name);
      if (field !== undefined) this.clearPeer(field);
    };
    reader.onerror = () => {
      this.imageNames.update((names) => ({ ...names, [name]: '' }));
      this.designer.setInput(name, '');
    };
    reader.readAsDataURL(file);
    return done;
  }

  /** What a thumbnail shows: a new image as it is, a stored path through the run's endpoint. */
  protected imageSrc(item: string): string | null {
    if (isImageDataUrl(item)) return item;
    const runId = this.designer.runId() ?? this.designer.run()?.id ?? null;
    return runId === null ? null : this.runsApi.inputImageUrl(runId, item);
  }

  /** The thumbnails of the images the composer holds. */
  protected readonly composerThumbs = computed(() =>
    this.designer
      .picked(IMAGES_FIELD)
      .map((item) => this.imageSrc(item))
      .filter((src): src is string => src !== null),
  );

  /** The thumbnails of the shown run's images, under its question. */
  protected readonly questionImages = computed(() =>
    this.designer
      .shownImages()
      .map((item) => this.imageSrc(item))
      .filter((src): src is string => src !== null),
  );

  /** The images the composer's list holds now. */
  private heldImages(): string[] {
    return this.designer.picked(IMAGES_FIELD);
  }

  private setHeldImages(list: string[]): void {
    this.designer.setInput(IMAGES_FIELD, list);
  }

  /** Files picked, pasted or dropped into the reference images. */
  protected async addImages(files: readonly File[]): Promise<void> {
    const field = this.imagesField();
    if (field !== null) {
      const max = field.max ?? 4;
      const { accepted, error } = await addImageFiles(
        files,
        this.heldImages().length,
        field.label,
        max,
      );
      this.setHeldImages([...this.heldImages(), ...accepted].slice(0, max));
      this.attachError.set(error);
      if (accepted.length > 0) {
        this.imagesAnswered(
          field.name,
          files.slice(0, accepted.length).map((file) => file.name),
        );
      }
      return;
    }
    // No `images` field: the one `image` field takes the first file (the
    // run form then checks its type and size on Execute).
    const image = this.imageField();
    if (image === null || files.length === 0) return;
    await this.setImageFile(image.name, files[0]);
    if (this.designer.inputValue(image.name) !== '') {
      this.imagesAnswered(image.name, [files[0].name]);
    }
  }

  protected removeImage(index: number): void {
    this.setHeldImages(this.heldImages().filter((_, i) => i !== index));
    this.attachError.set(null);
  }

  /** The refusal shown under the attachments: a file refused, else the form's. */
  protected imagesError(): string | null {
    return this.attachError() ?? this.fieldError(IMAGES_FIELD);
  }

  /** Paste: only images are taken; a plain text paste is left alone. */
  protected onPaste(event: ClipboardEvent): void {
    if (!this.takesImages()) return;
    const files = imageFilesOf(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void this.addImages(files);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.takesImages() || !dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    this.dragging.set(false);
    if (!this.takesImages() || !dragHasFiles(event.dataTransfer)) return;
    // Files dropped on the box never navigate the window.
    event.preventDefault();
    const files = imageFilesOf(event.dataTransfer);
    if (files.length > 0) void this.addImages(files);
  }

  protected onCheck(name: string, event: Event): void {
    this.designer.setInput(name, (event.target as HTMLInputElement).checked);
  }

  /** The datasets a `dataset` or `datasets` field offers: its kinds only, when it names some. */
  protected datasetChoices(field: WorkflowInputField): Dataset[] {
    const kinds = field.datasourceKinds;
    const all = this.designer.datasets();
    if (!kinds || kinds.length === 0) return all;
    return all.filter(
      (d) => d.datasourceKind !== undefined && kinds.includes(d.datasourceKind),
    );
  }

  /** An example chip fills the composer (and the question) and does not run (plan 4.2). */
  protected pickExample(text: string): void {
    const field = this.designer.questionField();
    if (field !== null) this.designer.setInput(field, text);
    this.draft.set(text);
    this.focusComposer();
  }

  // ---------------------------------------------------------------------
  // The conversation before a run (ui.md 4.4b): the composer's message fills
  // the prompt, then the agent asks for each required input still missing,
  // one at a time, in its own voice (written by the app, no model call).
  // ---------------------------------------------------------------------

  /** Who speaks for the workflow: its lead agent, else the workflow itself. */
  protected readonly voice = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? null : leadVoice(workflow);
  });

  /** The field the composer's message fills (the question, else Review a Website's URL). */
  protected readonly prompt = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null
      ? null
      : promptField(workflow.input, this.designer.questionField());
  });

  /**
   * A prompt with a default (instructions the workflow fills in itself) is
   * not mirrored in the composer: it keeps its default unless something is
   * typed, and is edited in the inputs menu.
   */
  private readonly promptHasDefault = computed(
    () => this.prompt()?.default !== undefined,
  );

  /** What the composer holds now. */
  protected readonly draft = signal('');
  /** The turns so far, before the run (and above it once it started). */
  protected readonly transcript = signal<ChatEntry[]>([]);
  /** The field the agent waits on; null when it waits on nothing. */
  protected readonly pending = signal<PendingAsk | null>(null);
  /** Every choice of the pending pick shows, not only the first five. */
  protected readonly showAllOptions = signal(false);
  /** A run was asked for and has no id yet. */
  private readonly awaitingStart = signal(false);
  /** The run the shown turns led to. */
  private readonly transcriptRunId = signal<string | null>(null);
  /** The required checkboxes answered in this conversation. */
  private readonly answered = signal<ReadonlySet<string>>(new Set());
  private nextEntryId = 1;
  /** The last refusal message said in the chat (one per refusal). */
  private reportedError: string | null = null;
  private round = 0;
  /** Questions asked in this round (the first opens with `First,`). */
  private askedThisRound = 0;

  /** The inputs menu behind `+` is open, and which of its entries is unfolded. */
  protected readonly menuOpen = signal(false);
  protected readonly menuSection = signal<string | null>(null);
  /** The search of the unfolded pick in the inputs menu. */
  protected readonly menuQuery = signal('');

  /** The composer's placeholder: `Message Avery`, or what the agent waits on. */
  protected readonly placeholder = computed(() => {
    const workflow = this.designer.workflow();
    if (workflow === null) return '';
    const base = composerPlaceholder(workflow);
    const pending = this.pending();
    return pending === null ? base : pendingPlaceholder(pending.field, base);
  });

  /** The choices of the pending pick, filtered by what is typed. */
  protected readonly pendingPick = computed(() => {
    const pending = this.pending();
    if (pending === null) return null;
    if (pending.kind !== 'pick-many' && pending.kind !== 'pick-one')
      return null;
    const all = this.optionsFor(pending.field);
    const { shown, total } = shownOptions(
      all,
      this.draft(),
      this.showAllOptions(),
    );
    return { all, shown, total, selected: this.selectedFor(pending.field) };
  });

  /** Whether Send does something now. */
  protected readonly canSend = computed(() => {
    const workflow = this.designer.workflow();
    if (workflow === null || this.designer.running()) return false;
    if (workflow.runRequirement) return false;
    const text = this.draft().trim();
    const pending = this.pending();
    if (pending !== null) {
      if (pending.kind === 'text') return text !== '';
      const pick = this.pendingPick();
      return pick !== null && typedOption(pick.all, text) !== null;
    }
    if (text !== '') return true;
    const prompt = this.prompt();
    return (
      prompt === null ||
      (this.promptHasDefault() &&
        hasInputValue(this.designer.inputValues()[prompt.name]))
    );
  });

  /**
   * The turns shown above the run they led to: those after the message
   * that asked (the run's own question bubble shows that one).
   */
  protected readonly runTranscript = computed(() => {
    const runId = this.designer.runId();
    const ours =
      (runId !== null && runId === this.transcriptRunId()) ||
      (this.awaitingStart() && this.designer.running());
    if (!ours) return [];
    const list = this.transcript();
    const last = list.length ? list[list.length - 1].round : 0;
    return list.filter((entry) => entry.round === last && !entry.question);
  });

  /** The composer, emptied after its message is sent. */
  protected setDraft(text: string): void {
    this.draft.set(text);
  }

  /** The composer holds the prompt the input holds (New question, Run again, a new workflow). */
  private syncDraft(): void {
    const prompt = this.prompt();
    this.draft.set(
      prompt === null || this.promptHasDefault()
        ? ''
        : this.designer.inputValue(prompt.name),
    );
  }

  /** A new conversation: no turns, nothing pending. */
  private resetIntake(): void {
    this.transcript.set([]);
    this.pending.set(null);
    this.showAllOptions.set(false);
    this.awaitingStart.set(false);
    this.transcriptRunId.set(null);
    this.answered.set(new Set());
    this.menuOpen.set(false);
    this.askedThisRound = 0;
  }

  /** New question: the chat drops the run shown and starts a new conversation. */
  protected newQuestion(): void {
    this.designer.newQuestion();
    this.resetIntake();
  }

  /** Run again: a new conversation holding the shown run's whole input. */
  protected runAgain(): void {
    this.designer.runAgain();
    this.resetIntake();
  }

  private push(entry: Omit<ChatEntry, 'id' | 'round'>): number {
    const id = this.nextEntryId++;
    this.transcript.update((list) => [
      ...list,
      { ...entry, id, round: this.round },
    ]);
    return id;
  }

  /** Send: answers what the agent waits on, else sends a message that fills the prompt. */
  protected send(): void {
    if (!this.canSend()) return;
    const pending = this.pending();
    if (pending !== null) {
      this.answerTyped(pending);
      return;
    }
    const raw = this.draft();
    const text = raw.trim();
    const prompt = this.prompt();
    this.draft.set('');
    this.menuOpen.set(false);
    this.round++;
    this.askedThisRound = 0;
    if (text !== '') {
      // The prompt takes the message as typed, as the form sent it.
      if (prompt !== null) this.designer.setInput(prompt.name, raw);
      this.push({ from: 'user', text, question: true });
    }
    this.advance(text !== '');
  }

  /** What was typed answers the pending text field, or picks a choice by name. */
  private answerTyped(pending: PendingAsk): void {
    const text = this.draft().trim();
    if (pending.kind === 'text') {
      this.draft.set('');
      this.designer.setInput(pending.field.name, text);
      this.push({ from: 'user', text });
      this.advance(true);
      return;
    }
    const pick = this.pendingPick();
    const option = pick === null ? null : typedOption(pick.all, text);
    if (option === null) return;
    this.draft.set('');
    if (pending.kind === 'pick-many') {
      if (!pick!.selected.includes(option.id)) {
        this.designer.toggleDataset(pending.field.name, option.id);
      }
      return;
    }
    this.pickIntake(pending.field, option);
  }

  /**
   * The next required input still missing is asked for; with none, the run
   * starts on the same request as before (api.md 119).
   */
  private advance(typed: boolean): void {
    const workflow = this.designer.workflow();
    if (workflow === null) return;
    const missing = missingFields(
      workflow.input,
      this.designer.inputValues(),
      this.answered(),
    );
    if (missing.length === 0) {
      this.pending.set(null);
      this.awaitingStart.set(true);
      this.designer.execute();
      return;
    }
    const field = missing[0];
    const text = askText(field, workflow, {
      first: this.askedThisRound === 0,
      typed,
    });
    this.askedThisRound++;
    this.ask(field, this.push({ from: 'agent', text, field: field.name }));
  }

  private ask(field: WorkflowInputField, entryId: number): void {
    this.pending.set({ field, kind: intakeKind(field), entryId });
    this.showAllOptions.set(false);
    setTimeout(() => this.focusComposer());
  }

  /** The run was refused: the agent says why, then asks again for the field at fault. */
  private onRefused(messages: string[], fieldName: string | null): void {
    const workflow = this.designer.workflow();
    const field =
      fieldName === null
        ? undefined
        : workflow?.input.find((f) => f.name === fieldName && !f.hidden);
    const prompt = this.prompt();
    const reAsk = field !== undefined && field.name !== prompt?.name;
    const id = this.push({
      from: 'agent',
      text: refusalText(messages),
      error: true,
      ...(reAsk ? { field: field.name } : {}),
    });
    if (reAsk) this.ask(field, id);
    else if (field !== undefined && !this.promptHasDefault()) this.syncDraft();
  }

  /** The pending ask is the turn `entryId`. */
  protected isPendingEntry(entryId: number): boolean {
    return this.pending()?.entryId === entryId;
  }

  /** A choice's Add in the pending pick. */
  protected pickIntake(field: WorkflowInputField, option: IntakeOption): void {
    if (field.type === 'datasets') {
      this.designer.toggleDataset(field.name, option.id);
      return;
    }
    this.designer.setInput(field.name, option.id);
    if (field.type === 'artifact') this.clearPeer(field);
    this.push({ from: 'user', text: '', chips: [option.name] });
    this.advance(true);
  }

  /** Continue with the datasets picked. */
  protected continueIntake(): void {
    const pending = this.pending();
    if (pending === null) return;
    const picked = this.selectedFor(pending.field);
    if (picked.length === 0) return;
    const names = new Map(
      this.optionsFor(pending.field).map((option) => [option.id, option.name]),
    );
    this.push({
      from: 'user',
      text: '',
      chips: picked.map((id) => names.get(id) ?? id),
    });
    this.advance(true);
  }

  /** Yes or No to a required checkbox. */
  protected answerYesNo(field: WorkflowInputField, value: boolean): void {
    this.designer.setInput(field.name, value);
    this.answered.update((names) => new Set([...names, field.name]));
    this.push({ from: 'user', text: value ? 'Yes' : 'No' });
    this.advance(true);
  }

  /** An image picked in the agent's upload card. */
  protected onIntakeFile(field: WorkflowInputField, event: Event): void {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    (event.target as HTMLInputElement).value = '';
    if (files.length > 0) void this.addImagesTo(field, files);
  }

  /** Images dropped on the agent's upload card. */
  protected onIntakeDrop(field: WorkflowInputField, event: DragEvent): void {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const files = imageFilesOf(event.dataTransfer);
    if (files.length > 0) void this.addImagesTo(field, files);
  }

  private async addImagesTo(
    field: WorkflowInputField,
    files: readonly File[],
  ): Promise<void> {
    if (field.type === 'images') {
      await this.addImages(files);
      return;
    }
    await this.setImageFile(field.name, files[0]);
    if (this.designer.inputValue(field.name) !== '') {
      this.imagesAnswered(field.name, [files[0].name]);
    }
  }

  /** Images added while the agent waits on that field: they answer it. */
  private imagesAnswered(fieldName: string, names: string[]): void {
    const pending = this.pending();
    if (pending === null || pending.field.name !== fieldName) return;
    this.push({ from: 'user', text: '', chips: names });
    this.advance(true);
  }

  // ---- The inputs menu behind `+` -----------------------------------

  /** The menu's ADD entries: every input but the checkboxes and the composer's own prompt. */
  protected readonly menuAddFields = computed(() => {
    const prompt = this.prompt();
    return (this.designer.workflow()?.input ?? []).filter(
      (field) =>
        !field.hidden &&
        field.type !== 'boolean' &&
        (field.name !== prompt?.name || this.promptHasDefault()),
    );
  });

  /** The menu's OPTIONS: each checkbox, as a switch. */
  protected readonly menuOptionFields = computed(() =>
    (this.designer.workflow()?.input ?? []).filter(
      (field) => !field.hidden && field.type === 'boolean',
    ),
  );

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.menuQuery.set('');
  }

  protected closeMenu(): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    this.focusComposer();
  }

  protected toggleSection(name: string): void {
    this.menuSection.update((open) => (open === name ? null : name));
    this.menuQuery.set('');
  }

  /** The icon of an ADD entry. */
  protected fieldIcon(field: WorkflowInputField) {
    switch (field.type) {
      case 'datasets':
      case 'dataset':
        return Database;
      case 'artifact':
        return LayoutDashboard;
      case 'image':
      case 'images':
        return ImageIcon;
      case 'boolean':
        return ToggleRight;
      default:
        return Type;
    }
  }

  /** The muted note of an ADD entry: `1 picked`, `up to 4`, the value. */
  protected fieldNote(field: WorkflowInputField): string {
    switch (field.type) {
      case 'datasets':
      case 'images': {
        const n = this.designer.picked(field.name).length;
        if (n > 0) return `${n} picked`;
        return field.type === 'images' ? `up to ${field.max ?? 4}` : '';
      }
      case 'dataset':
      case 'artifact':
        return this.selectedFor(field).length > 0 ? '1 picked' : '';
      case 'image':
        return this.imageName(field.name);
      default:
        return field.required ? '' : 'optional';
    }
  }

  /** The menu's choices of a pick, filtered by its search. */
  protected menuOptions(field: WorkflowInputField): IntakeOption[] {
    return shownOptions(this.optionsFor(field), this.menuQuery(), true).shown;
  }

  /** A choice's Add in the inputs menu: a dataset toggles, a single pick replaces or clears. */
  protected pickInMenu(field: WorkflowInputField, option: IntakeOption): void {
    if (field.type === 'datasets') {
      this.designer.toggleDataset(field.name, option.id);
      return;
    }
    const on = this.selectedFor(field).includes(option.id);
    this.designer.setInput(field.name, on ? '' : option.id);
    if (!on && field.type === 'artifact') this.clearPeer(field);
  }

  /** The choices a pick offers: the datasets or artifacts of its kinds. */
  protected optionsFor(field: WorkflowInputField): IntakeOption[] {
    if (field.type === 'artifact') {
      return this.artifactChoices(field).map(artifactOption);
    }
    return this.datasetChoices(field).map((dataset) =>
      datasetOption(dataset, (kind) => kindLabel(kind as DatasourceKind)),
    );
  }

  /** The ids a pick holds now. */
  protected selectedFor(field: WorkflowInputField): string[] {
    if (field.type === 'datasets') return this.designer.picked(field.name);
    const value = this.designer.inputValue(field.name);
    return value === '' ? [] : [value];
  }

  /** What is set through the menu, as removable chips above the composer. */
  protected readonly chips = computed(() => {
    const chips: {
      field: WorkflowInputField;
      key: string;
      label: string;
      index: number;
    }[] = [];
    for (const field of this.menuAddFields()) {
      if (field.type === 'datasets') {
        this.designer
          .picked(field.name)
          .forEach((name, index) =>
            chips.push({ field, key: name, label: name, index }),
          );
      } else if (field.type === 'images') {
        this.designer.picked(field.name).forEach((_, index) =>
          chips.push({
            field,
            key: `${index}`,
            label: `Image ${index + 1}`,
            index,
          }),
        );
      } else if (field.type === 'image') {
        if (this.designer.inputValue(field.name) !== '') {
          const label = this.imageName(field.name) || field.label;
          chips.push({ field, key: label, label, index: 0 });
        }
      } else if (field.type === 'dataset' || field.type === 'artifact') {
        const id = this.designer.inputValue(field.name);
        if (id === '') continue;
        const name =
          this.optionsFor(field).find((option) => option.id === id)?.name ?? id;
        chips.push({ field, key: id, label: name, index: 0 });
      } else {
        const value = this.designer.inputValue(field.name).trim();
        const fallback =
          field.default === undefined ? '' : String(field.default).trim();
        if (value === '' || value === fallback) continue;
        const short = value.length > 32 ? `${value.slice(0, 31)}…` : value;
        chips.push({
          field,
          key: field.name,
          label: `${field.label}: ${short}`,
          index: 0,
        });
      }
    }
    // A switch turned away from its default: `Visual review with Iris off`.
    for (const field of this.menuOptionFields()) {
      const on = this.designer.checked(field.name);
      if (on === (field.default === true)) continue;
      const title = optionLabel(field.label).title;
      chips.push({
        field,
        key: field.name,
        label: `${title} ${on ? 'on' : 'off'}`,
        index: 0,
      });
    }
    return chips;
  });

  protected removeChip(chip: {
    field: WorkflowInputField;
    key: string;
    index: number;
  }): void {
    const field = chip.field;
    if (field.type === 'datasets') {
      this.designer.toggleDataset(field.name, chip.key);
    } else if (field.type === 'images') {
      this.removeImage(chip.index);
    } else if (field.type === 'boolean') {
      this.designer.setInput(field.name, field.default === true);
    } else if (field.type === 'image') {
      void this.setImageFile(field.name, undefined);
      const control = this.host.nativeElement.querySelector<HTMLInputElement>(
        `[id="${this.inputId(field.name)}"]`,
      );
      if (control !== null) control.value = '';
    } else {
      this.designer.setInput(
        field.name,
        field.default === undefined ? '' : String(field.default),
      );
    }
  }
}
